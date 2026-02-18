// Copyright (C) 2026 Signal Slot Inc.
// SPDX-License-Identifier: LGPL-3.0-only OR GPL-2.0-only OR GPL-3.0-only
//
// PSD Run WASM module - main thread Qt rendering with PsdExporter hints support.
// Based on psd-compare's psddiff_qt.cpp + mcp-psd2x layer image/hints functions.

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <vector>
#include <set>

#include <QtCore/QBuffer>
#include <QtCore/QFile>
#include <QtCore/QDir>
#include <QtCore/QJsonArray>
#include <QtCore/QJsonDocument>
#include <QtCore/QJsonObject>
#include <QtWidgets/QApplication>
#include <QtPlugin>
#include <QtGui/QImage>
#include <QtGui/QPainter>
#include <QtGui/QFontDatabase>

#include <QtPsdCore/QPsdParser>
#include <QtPsdCore/QPsdLayerRecord>
#include <QtPsdCore/qpsdblend.h>
#include <QtPsdCore/QPsdSectionDividerSetting>

#include <QtPsdGui/QPsdAbstractLayerItem>
#include <QtPsdGui/QPsdFolderLayerItem>
#include <QtPsdGui/QPsdTextLayerItem>
#include <QtPsdGui/QPsdShapeLayerItem>
#include <QtPsdGui/QPsdImageLayerItem>
#include <QtPsdGui/QPsdGuiLayerTreeItemModel>
#include <QtPsdGui/qpsdguiglobal.h>

#include <QtPsdWidget/QPsdWidgetTreeItemModel>
#include <QtPsdWidget/QPsdScene>

#include <QtPsdExporter/QPsdExporterTreeItemModel>

// Import static plugins for WASM
// Additional Layer Information plugins
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationAnnoPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationBlncPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationBritPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationBrstPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationClrlPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationCurvPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationDataPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationExpaPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationFeidPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationFMskPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationGrdmPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationHue2Plugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationLclrPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationLevlPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationLfx2Plugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationLMskPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationLnk_Plugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationLr16Plugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationLrFXPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationLsctPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationLsdkPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationLuniPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationMixrPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationNonePlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationPattPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationPhflPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationPlLdPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationQpointFPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationSelcPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationShmdPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationSoLdPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationTyShPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationU8Plugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationU16Plugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationU32Plugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationUnknownPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationV16DescriptorPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationVmskPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationVogkPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationVscgPlugin)
Q_IMPORT_PLUGIN(QPsdAdditionalLayerInformationVstkPlugin)
// Descriptor plugins
Q_IMPORT_PLUGIN(QPsdDescriptorBoolPlugin)
Q_IMPORT_PLUGIN(QPsdDescriptorDoubPlugin)
Q_IMPORT_PLUGIN(QPsdDescriptorEnumPlugin)
Q_IMPORT_PLUGIN(QPsdDescriptorLongPlugin)
Q_IMPORT_PLUGIN(QPsdDescriptorObArPlugin)
Q_IMPORT_PLUGIN(QPsdDescriptorObjPlugin)
Q_IMPORT_PLUGIN(QPsdDescriptorObjcPlugin)
Q_IMPORT_PLUGIN(QPsdDescriptorPthPlugin)
Q_IMPORT_PLUGIN(QPsdDescriptorTdtaPlugin)
Q_IMPORT_PLUGIN(QPsdDescriptorTextPlugin)
Q_IMPORT_PLUGIN(QPsdDescriptorUntFPlugin)
Q_IMPORT_PLUGIN(QPsdDescriptorVlLsPlugin)
// Effects layer plugins
Q_IMPORT_PLUGIN(QPsdEffectsLayerBevlPlugin)
Q_IMPORT_PLUGIN(QPsdEffectsLayerCmnSPlugin)
Q_IMPORT_PLUGIN(QPsdEffectsLayerIglwPlugin)
Q_IMPORT_PLUGIN(QPsdEffectsLayerOglwPlugin)
Q_IMPORT_PLUGIN(QPsdEffectsLayerShadowPlugin)
Q_IMPORT_PLUGIN(QPsdEffectsLayerSofiPlugin)

using namespace emscripten;

// Global Qt application instance
static int s_argc = 1;
static char* s_argv[] = { (char*)"psdrun_qt", nullptr };
static QApplication* s_app = nullptr;

// Buffer for receiving data from JavaScript
static QByteArray s_dataBuffer;

void ensureQtApp() {
    if (!s_app) {
        s_app = new QApplication(s_argc, s_argv);
        QDir().mkpath("/tmp");
    }
}

void allocateBuffer(int size) {
    s_dataBuffer.resize(size);
}

val getBufferView() {
    return val(typed_memory_view(s_dataBuffer.size(),
               reinterpret_cast<unsigned char*>(s_dataBuffer.data())));
}

// Font buffer for receiving font data from JavaScript
static QByteArray s_fontBuffer;
static std::vector<std::string> s_registeredFontFamilies;

void allocateFontBuffer(int size) {
    s_fontBuffer.resize(size);
}

val getFontBufferView() {
    return val(typed_memory_view(s_fontBuffer.size(),
               reinterpret_cast<unsigned char*>(s_fontBuffer.data())));
}

val registerFont(int dataSize, const std::string& filename) {
    val result = val::object();
    ensureQtApp();

    if (dataSize <= 0 || dataSize > s_fontBuffer.size()) {
        result.set("error", "Invalid font data size");
        return result;
    }

    QByteArray fontData(s_fontBuffer.constData(), dataSize);
    int fontId = QFontDatabase::addApplicationFontFromData(fontData);

    if (fontId < 0) {
        result.set("error", "Failed to register font");
        return result;
    }

    QStringList families = QFontDatabase::applicationFontFamilies(fontId);
    if (families.isEmpty()) {
        result.set("error", "No font families found in file");
        return result;
    }

    val familiesArray = val::array();
    for (const QString& family : families) {
        std::string familyStr = family.toStdString();
        s_registeredFontFamilies.push_back(familyStr);
        familiesArray.call<void>("push", familyStr);
    }

    result.set("fontId", fontId);
    result.set("families", familiesArray);
    return result;
}

val getRegisteredFonts() {
    val result = val::array();
    for (const auto& family : s_registeredFontFamilies) {
        result.call<void>("push", family);
    }
    return result;
}

std::string blendModeToString(QPsdBlend::Mode mode) {
    switch (mode) {
        case QPsdBlend::PassThrough: return "passThrough";
        case QPsdBlend::Normal: return "normal";
        case QPsdBlend::Dissolve: return "dissolve";
        case QPsdBlend::Darken: return "darken";
        case QPsdBlend::Multiply: return "multiply";
        case QPsdBlend::ColorBurn: return "colorBurn";
        case QPsdBlend::LinearBurn: return "linearBurn";
        case QPsdBlend::DarkerColor: return "darkerColor";
        case QPsdBlend::Lighten: return "lighten";
        case QPsdBlend::Screen: return "screen";
        case QPsdBlend::ColorDodge: return "colorDodge";
        case QPsdBlend::LinearDodge: return "linearDodge";
        case QPsdBlend::LighterColor: return "lighterColor";
        case QPsdBlend::Overlay: return "overlay";
        case QPsdBlend::SoftLight: return "softLight";
        case QPsdBlend::HardLight: return "hardLight";
        case QPsdBlend::VividLight: return "vividLight";
        case QPsdBlend::LinearLight: return "linearLight";
        case QPsdBlend::PinLight: return "pinLight";
        case QPsdBlend::HardMix: return "hardMix";
        case QPsdBlend::Difference: return "difference";
        case QPsdBlend::Exclusion: return "exclusion";
        case QPsdBlend::Subtract: return "subtract";
        case QPsdBlend::Divide: return "divide";
        case QPsdBlend::Hue: return "hue";
        case QPsdBlend::Saturation: return "saturation";
        case QPsdBlend::Color: return "color";
        case QPsdBlend::Luminosity: return "luminosity";
        default: return "normal";
    }
}

std::string itemTypeToString(QPsdAbstractLayerItem::Type type) {
    switch (type) {
        case QPsdAbstractLayerItem::Text: return "text";
        case QPsdAbstractLayerItem::Shape: return "shape";
        case QPsdAbstractLayerItem::Image: return "image";
        case QPsdAbstractLayerItem::Folder: return "folder";
        default: return "unknown";
    }
}

// Structure to hold PSD data including models and scene
struct PsdData {
    QString tempPath;
    std::unique_ptr<QPsdGuiLayerTreeItemModel> guiModel;
    std::unique_ptr<QPsdExporterTreeItemModel> exporterModel;
    std::unique_ptr<QPsdWidgetTreeItemModel> widgetModel;
    std::unique_ptr<QPsdScene> scene;
    int width = 0;
    int height = 0;
};

static PsdData* s_parsers[16] = {nullptr};

static int findFreeHandle() {
    for (int i = 1; i < 16; i++) {
        if (s_parsers[i] == nullptr) return i;
    }
    return -1;
}

// ========== Layer image compositing helpers (ported from mcp-psd2x) ==========

// Recursively compute bounding box of all visible children under parent
static QRect computeBoundingRect(const QPsdExporterTreeItemModel* model, const QModelIndex& parent) {
    QRect bounds;
    for (int row = 0; row < model->rowCount(parent); ++row) {
        auto index = model->index(row, 0, parent);
        const auto* item = model->layerItem(index);
        if (!item || !item->isVisible()) continue;
        if (item->type() == QPsdAbstractLayerItem::Folder) {
            bounds = bounds.united(computeBoundingRect(model, index));
        } else {
            bounds = bounds.united(item->rect());
        }
    }
    return bounds;
}

// Apply transparency mask and raster layer mask to a layer's image
static QImage applyMasks(const QPsdAbstractLayerItem* item) {
    QImage image = item->image();
    if (image.isNull()) return image;

    // Apply transparency mask for layers without built-in alpha
    const QImage transMask = item->transparencyMask();
    if (!transMask.isNull() && !image.hasAlphaChannel()) {
        image = image.convertToFormat(QImage::Format_ARGB32);
        for (int y = 0; y < qMin(image.height(), transMask.height()); ++y) {
            QRgb* imgLine = reinterpret_cast<QRgb*>(image.scanLine(y));
            const uchar* maskLine = transMask.constScanLine(y);
            for (int x = 0; x < qMin(image.width(), transMask.width()); ++x) {
                imgLine[x] = qRgba(qRed(imgLine[x]), qGreen(imgLine[x]),
                                   qBlue(imgLine[x]), maskLine[x]);
            }
        }
    }

    // Apply raster layer mask if present
    const QImage layerMask = item->layerMask();
    if (!layerMask.isNull()) {
        const QRect maskRect = item->layerMaskRect();
        const QRect layerRect = item->rect();
        const int defaultColor = item->layerMaskDefaultColor();

        image = image.convertToFormat(QImage::Format_ARGB32);
        for (int y = 0; y < image.height(); ++y) {
            QRgb* scanLine = reinterpret_cast<QRgb*>(image.scanLine(y));
            for (int x = 0; x < image.width(); ++x) {
                const int maskX = (layerRect.x() + x) - maskRect.x();
                const int maskY = (layerRect.y() + y) - maskRect.y();
                int maskValue = defaultColor;
                if (maskX >= 0 && maskX < layerMask.width() &&
                    maskY >= 0 && maskY < layerMask.height()) {
                    maskValue = qGray(layerMask.pixel(maskX, maskY));
                }
                const int alpha = qAlpha(scanLine[x]);
                const int newAlpha = (alpha * maskValue) / 255;
                scanLine[x] = qRgba(qRed(scanLine[x]), qGreen(scanLine[x]),
                                    qBlue(scanLine[x]), newAlpha);
            }
        }
    }

    return image;
}

// Recursively composite visible children onto the given painter
static void compositeChildren(const QPsdExporterTreeItemModel* model,
                              const QModelIndex& parent, QPainter& painter,
                              const QPoint& origin, bool passThrough) {
    const int count = model->rowCount(parent);
    // Bottom-to-top (last row = bottommost layer in PSD model)
    for (int row = count - 1; row >= 0; --row) {
        auto index = model->index(row, 0, parent);
        const auto* item = model->layerItem(index);
        if (!item || !item->isVisible()) continue;

        if (item->type() == QPsdAbstractLayerItem::Folder) {
            const auto folderBlend = item->record().blendMode();
            const bool folderPassThrough = (folderBlend == QPsdBlend::PassThrough);

            if (folderPassThrough) {
                compositeChildren(model, index, painter, origin, true);
            } else {
                const QRect childBounds = computeBoundingRect(model, index);
                if (childBounds.isEmpty()) continue;

                QImage groupCanvas(childBounds.size(), QImage::Format_ARGB32);
                groupCanvas.fill(Qt::transparent);

                QPainter groupPainter(&groupCanvas);
                compositeChildren(model, index, groupPainter, childBounds.topLeft(), false);
                groupPainter.end();

                painter.save();
                painter.setCompositionMode(QtPsdGui::compositionMode(folderBlend));
                painter.setOpacity(painter.opacity() * item->opacity() * item->fillOpacity());
                painter.drawImage(childBounds.topLeft() - origin, groupCanvas);
                painter.restore();
            }
        } else {
            QImage layerImage = applyMasks(item);
            if (layerImage.isNull()) continue;

            painter.save();
            painter.setCompositionMode(
                QtPsdGui::compositionMode(item->record().blendMode()));
            painter.setOpacity(painter.opacity() * item->opacity() * item->fillOpacity());
            painter.drawImage(item->rect().topLeft() - origin, layerImage);
            painter.restore();
        }
    }
}

// ========== Main API functions ==========

// Parse PSD and return parser handle with extended layer info
val parsePsd(int dataSize) {
    ensureQtApp();
    val result = val::object();

    if (dataSize <= 0 || dataSize > s_dataBuffer.size()) {
        result.set("error", "Invalid data size");
        return result;
    }

    PsdData* psdData = new PsdData();

    // Save to temp file
    static int tempFileCounter = 0;
    psdData->tempPath = QString("/tmp/psd_%1.psd").arg(tempFileCounter++);
    QFile tempFile(psdData->tempPath);
    if (!tempFile.open(QIODevice::WriteOnly)) {
        delete psdData;
        result.set("error", "Cannot create temp file");
        return result;
    }
    tempFile.write(s_dataBuffer.constData(), dataSize);
    tempFile.close();

    // Load using QPsdWidgetTreeItemModel (for scene rendering)
    psdData->widgetModel = std::make_unique<QPsdWidgetTreeItemModel>();
    psdData->widgetModel->load(psdData->tempPath);

    if (!psdData->widgetModel->errorMessage().isEmpty()) {
        QString error = psdData->widgetModel->errorMessage();
        delete psdData;
        result.set("error", std::string("Failed to load PSD: ") + error.toStdString());
        return result;
    }

    QSize size = psdData->widgetModel->size();
    psdData->width = size.width();
    psdData->height = size.height();

    if (psdData->width == 0 || psdData->height == 0) {
        delete psdData;
        result.set("error", "Invalid dimensions");
        return result;
    }

    // Create scene for Qt rendering
    psdData->scene = std::make_unique<QPsdScene>();
    psdData->scene->setModel(psdData->widgetModel.get());

    // Load using QPsdExporterTreeItemModel (for hints + layer details)
    psdData->guiModel = std::make_unique<QPsdGuiLayerTreeItemModel>();
    psdData->exporterModel = std::make_unique<QPsdExporterTreeItemModel>();
    psdData->exporterModel->setSourceModel(psdData->guiModel.get());
    psdData->exporterModel->load(psdData->tempPath);

    if (!psdData->exporterModel->errorMessage().isEmpty()) {
        QString error = psdData->exporterModel->errorMessage();
        delete psdData;
        result.set("error", std::string("Failed to load exporter model: ") + error.toStdString());
        return result;
    }

    // Store in handle array
    int handle = findFreeHandle();
    if (handle < 0) {
        delete psdData;
        result.set("error", "Too many parsers allocated");
        return result;
    }
    s_parsers[handle] = psdData;

    result.set("handle", handle);
    result.set("width", psdData->width);
    result.set("height", psdData->height);

    // Build layers array from widget model (for scene-based rendering)
    val layers = val::array();

    std::function<void(const QModelIndex&)> traverseModel = [&](const QModelIndex& parent) {
        for (int row = 0; row < psdData->widgetModel->rowCount(parent); ++row) {
            QModelIndex index = psdData->widgetModel->index(row, 0, parent);
            val layer = val::object();

            int layerId = psdData->widgetModel->layerId(index);
            layer.set("id", layerId);
            layer.set("index", row);
            layer.set("name", psdData->widgetModel->layerName(index).toStdString());

            const auto* item = psdData->widgetModel->layerItem(index);
            if (item) {
                QRect rect = item->rect();
                layer.set("x", rect.x());
                layer.set("y", rect.y());
                layer.set("width", rect.width());
                layer.set("height", rect.height());
                layer.set("visible", item->isVisible());
                layer.set("opacity", static_cast<int>(item->opacity() * 255));
                layer.set("blendMode", blendModeToString(item->record().blendMode()));

                // Extended: itemType (text/shape/image/folder)
                layer.set("itemType", itemTypeToString(item->type()));

                // Extended: text content for text layers
                if (item->type() == QPsdAbstractLayerItem::Text) {
                    const auto* textItem = static_cast<const QPsdTextLayerItem*>(item);
                    QString fullText;
                    for (const auto& run : textItem->runs()) {
                        fullText += run.text;
                    }
                    layer.set("text", fullText.toStdString());
                }

                if (psdData->widgetModel->hasChildren(index)) {
                    layer.set("type", std::string("group"));
                } else {
                    layer.set("type", std::string("layer"));
                }
            }

            layers.call<void>("push", layer);

            if (psdData->widgetModel->hasChildren(index)) {
                traverseModel(index);
                // Emit groupEnd marker for LayerTree.tsx buildLayerTree()
                val groupEnd = val::object();
                groupEnd.set("id", layerId);
                groupEnd.set("type", std::string("groupEnd"));
                groupEnd.set("name", std::string(""));
                layers.call<void>("push", groupEnd);
            }
        }
    };
    traverseModel(QModelIndex());

    result.set("layers", layers);
    return result;
}

// Render composite using QPsdScene
val renderCompositeWithQt(double handleD, val hiddenLayerIdsVal, val shownLayerIdsVal) {
    val result = val::object();
    int handle = static_cast<int>(handleD);

    try {
        if (handle < 1 || handle >= 16 || s_parsers[handle] == nullptr) {
            result.set("error", std::string("Invalid parser handle"));
            return result;
        }
        PsdData* psdData = s_parsers[handle];

        int width = psdData->width;
        int height = psdData->height;

        // Parse hidden/shown layer IDs
        std::set<int> hiddenIds;
        std::set<int> shownIds;

        int hiddenCount = hiddenLayerIdsVal["length"].as<int>();
        for (int i = 0; i < hiddenCount; ++i) {
            hiddenIds.insert(hiddenLayerIdsVal[i].as<int>());
        }

        int shownCount = shownLayerIdsVal["length"].as<int>();
        for (int i = 0; i < shownCount; ++i) {
            shownIds.insert(shownLayerIdsVal[i].as<int>());
        }

        // Reset visibility to original state
        std::function<void(const QModelIndex&)> resetVisibility = [&](const QModelIndex& parent) {
            for (int row = 0; row < psdData->widgetModel->rowCount(parent); ++row) {
                QModelIndex index = psdData->widgetModel->index(row, 0, parent);
                const auto* layerItem = psdData->widgetModel->layerItem(index);
                if (layerItem) {
                    quint32 layerId = layerItem->id();
                    bool originalVisible = layerItem->isVisible();
                    psdData->scene->setItemVisible(layerId, originalVisible);
                }
                resetVisibility(index);
            }
        };
        resetVisibility(QModelIndex());

        // Apply visibility overrides
        for (int id : hiddenIds) {
            psdData->scene->setItemVisible(static_cast<quint32>(id), false);
        }
        for (int id : shownIds) {
            psdData->scene->setItemVisible(static_cast<quint32>(id), true);
        }

        // Render scene
        QImage image(width, height, QImage::Format_ARGB32_Premultiplied);
        image.fill(Qt::transparent);

        QPainter painter(&image);
        psdData->scene->render(&painter);
        painter.end();

        // Convert to RGBA8888
        QImage rgbaImage = image.convertToFormat(QImage::Format_RGBA8888);
        qsizetype byteCount = rgbaImage.sizeInBytes();

        val Uint8ClampedArray = val::global("Uint8ClampedArray");
        val data = Uint8ClampedArray.new_(static_cast<unsigned int>(byteCount));
        val sourceView = val(typed_memory_view(byteCount, rgbaImage.constBits()));
        data.call<void>("set", sourceView);

        result.set("width", width);
        result.set("height", height);
        result.set("data", data);
        return result;
    } catch (const std::exception& e) {
        result.set("error", std::string("Exception: ") + e.what());
        return result;
    } catch (...) {
        result.set("error", "Unknown exception");
        return result;
    }
}

// Get layer image as RGBA (ported from mcp-psd2x get_layer_image)
val getLayerImage(double handleD, int layerId) {
    val result = val::object();
    int handle = static_cast<int>(handleD);

    if (handle < 1 || handle >= 16 || s_parsers[handle] == nullptr) {
        result.set("error", "Invalid parser handle");
        return result;
    }
    PsdData* psdData = s_parsers[handle];

    // Find layer by ID in exporter model
    std::function<QModelIndex(const QModelIndex&)> findLayerById = [&](const QModelIndex& parent) -> QModelIndex {
        for (int row = 0; row < psdData->exporterModel->rowCount(parent); ++row) {
            auto index = psdData->exporterModel->index(row, 0, parent);
            if (psdData->exporterModel->layerId(index) == layerId) return index;
            auto found = findLayerById(index);
            if (found.isValid()) return found;
        }
        return {};
    };

    QModelIndex index = findLayerById(QModelIndex());
    if (!index.isValid()) {
        result.set("error", "Layer not found");
        return result;
    }

    const auto* item = psdData->exporterModel->layerItem(index);
    if (!item) {
        result.set("error", "Layer item is null");
        return result;
    }

    QImage layerImage;
    QRect layerRect;

    if (item->type() != QPsdAbstractLayerItem::Folder) {
        // Leaf layer: direct image
        layerImage = item->image();
        layerRect = item->rect();
    } else {
        // Folder: composite all visible children
        const QRect bounds = computeBoundingRect(psdData->exporterModel.get(), index);
        if (bounds.isEmpty()) {
            result.set("error", "Empty bounds");
            return result;
        }

        QImage canvas(bounds.size(), QImage::Format_ARGB32);
        canvas.fill(Qt::transparent);

        QPainter painter(&canvas);
        const auto blendMode = item->record().blendMode();
        const bool passThrough = (blendMode == QPsdBlend::PassThrough);
        compositeChildren(psdData->exporterModel.get(), index, painter, bounds.topLeft(), passThrough);
        painter.end();

        layerImage = canvas;
        layerRect = bounds;
    }

    if (layerImage.isNull()) {
        result.set("error", "Null image");
        return result;
    }

    // Convert to RGBA8888
    QImage rgbaImage = layerImage.convertToFormat(QImage::Format_RGBA8888);
    qsizetype byteCount = rgbaImage.sizeInBytes();

    val Uint8ClampedArray = val::global("Uint8ClampedArray");
    val data = Uint8ClampedArray.new_(static_cast<unsigned int>(byteCount));
    val sourceView = val(typed_memory_view(byteCount, rgbaImage.constBits()));
    data.call<void>("set", sourceView);

    result.set("width", rgbaImage.width());
    result.set("height", rgbaImage.height());
    result.set("x", layerRect.x());
    result.set("y", layerRect.y());
    result.set("data", data);
    return result;
}

// Export layer tree as JSON (ported from mcp-psd2x buildTree + get_layer_details)
val exportLayerJson(double handleD) {
    val result = val::object();
    int handle = static_cast<int>(handleD);

    if (handle < 1 || handle >= 16 || s_parsers[handle] == nullptr) {
        result.set("error", "Invalid parser handle");
        return result;
    }
    PsdData* psdData = s_parsers[handle];

    QJsonArray tree;
    std::function<void(const QModelIndex&, QJsonArray&)> buildTree = [&](const QModelIndex& parent, QJsonArray& array) {
        for (int row = 0; row < psdData->exporterModel->rowCount(parent); ++row) {
            auto index = psdData->exporterModel->index(row, 0, parent);
            QJsonObject obj;
            obj["layerId"] = psdData->exporterModel->layerId(index);
            obj["name"] = psdData->exporterModel->layerName(index);

            const auto* item = psdData->exporterModel->layerItem(index);
            if (item) {
                obj["type"] = QString::fromStdString(itemTypeToString(item->type()));

                const auto r = psdData->exporterModel->rect(index);
                obj["rect"] = QJsonObject{
                    {"x", r.x()}, {"y", r.y()},
                    {"width", r.width()}, {"height", r.height()}
                };
                obj["opacity"] = item->opacity();
                obj["fillOpacity"] = item->fillOpacity();
                obj["visible"] = item->isVisible();

                // Text content
                if (item->type() == QPsdAbstractLayerItem::Text) {
                    const auto* text = static_cast<const QPsdTextLayerItem*>(item);
                    QJsonArray runs;
                    for (const auto& run : text->runs()) {
                        runs.append(QJsonObject{
                            {"text", run.text},
                            {"font", run.font.family()},
                            {"originalFont", run.originalFontName},
                            {"fontSize", run.font.pointSizeF()},
                            {"color", run.color.name()},
                        });
                    }
                    obj["runs"] = runs;
                }

                // Shape info
                if (item->type() == QPsdAbstractLayerItem::Shape) {
                    const auto* shape = static_cast<const QPsdShapeLayerItem*>(item);
                    obj["brushColor"] = shape->brush().color().name();
                    const auto pi = shape->pathInfo();
                    static const char* pathTypes[] = {"none", "rectangle", "roundedRectangle", "path"};
                    obj["pathType"] = QString::fromLatin1(pathTypes[pi.type]);
                    if (pi.type == QPsdAbstractLayerItem::PathInfo::RoundedRectangle)
                        obj["cornerRadius"] = pi.radius;
                }

                // Folder info
                if (item->type() == QPsdAbstractLayerItem::Folder) {
                    const auto* folder = static_cast<const QPsdFolderLayerItem*>(item);
                    obj["childCount"] = psdData->exporterModel->rowCount(index);
                    obj["isOpened"] = folder->isOpened();
                }

                // Image info
                if (item->type() == QPsdAbstractLayerItem::Image) {
                    const auto lf = item->linkedFile();
                    if (!lf.name.isEmpty())
                        obj["linkedFile"] = lf.name;
                }
            }

            // Export hint
            const auto hint = psdData->exporterModel->layerHint(index);
            static const char* hintNames[] = {"embed", "merge", "custom", "native", "skip", "none"};
            obj["hintType"] = QString::fromLatin1(hintNames[hint.type]);
            obj["hintVisible"] = hint.visible;
            if (!hint.properties.isEmpty()) {
                QJsonArray propsArr;
                for (const auto& prop : hint.properties)
                    propsArr.append(prop);
                obj["hintProperties"] = propsArr;
            }

            if (psdData->exporterModel->rowCount(index) > 0) {
                QJsonArray children;
                buildTree(index, children);
                obj["children"] = children;
            }

            array.append(obj);
        }
    };
    buildTree(QModelIndex(), tree);

    QJsonObject root;
    root["width"] = psdData->width;
    root["height"] = psdData->height;
    root["layers"] = tree;

    QJsonDocument doc(root);
    result.set("json", doc.toJson(QJsonDocument::Compact).toStdString());
    return result;
}

// Get hints as JSON string (for localStorage persistence)
val getHintsJson(double handleD) {
    val result = val::object();
    int handle = static_cast<int>(handleD);

    if (handle < 1 || handle >= 16 || s_parsers[handle] == nullptr) {
        result.set("error", "Invalid parser handle");
        return result;
    }
    PsdData* psdData = s_parsers[handle];

    // Traverse all layers, collect non-default hints
    QJsonObject layerHints;
    std::function<void(const QModelIndex&)> traverse = [&](const QModelIndex& parent) {
        for (int row = 0; row < psdData->exporterModel->rowCount(parent); ++row) {
            auto index = psdData->exporterModel->index(row, 0, parent);
            const auto* item = psdData->exporterModel->layerItem(index);
            if (!item) continue;

            const auto hint = psdData->exporterModel->layerHint(index);
            if (!hint.isDefaultValue()) {
                QJsonObject hintObj;
                if (!hint.id.isEmpty()) hintObj["id"] = hint.id;
                hintObj["type"] = static_cast<int>(hint.type);
                if (!hint.componentName.isEmpty()) hintObj["name"] = hint.componentName;
                hintObj["native"] = static_cast<int>(hint.baseElement);
                hintObj["visible"] = hint.visible;
                if (!hint.properties.isEmpty()) {
                    QStringList propList = hint.properties.values();
                    std::sort(propList.begin(), propList.end());
                    hintObj["properties"] = QJsonArray::fromStringList(propList);
                }
                layerHints[QString::number(item->id())] = hintObj;
            }
            traverse(index);
        }
    };
    traverse(QModelIndex());

    QJsonObject root;
    root["qtpsdparser.hint"] = 1;
    root["layers"] = layerHints;

    QJsonDocument doc(root);
    result.set("json", doc.toJson(QJsonDocument::Compact).toStdString());
    return result;
}

// Set hints from JSON string (restore from localStorage)
val setHintsJson(double handleD, const std::string& jsonStr) {
    val result = val::object();
    int handle = static_cast<int>(handleD);

    if (handle < 1 || handle >= 16 || s_parsers[handle] == nullptr) {
        result.set("error", "Invalid parser handle");
        return result;
    }
    PsdData* psdData = s_parsers[handle];

    QJsonDocument doc = QJsonDocument::fromJson(QByteArray::fromStdString(jsonStr));
    if (doc.isNull()) {
        result.set("error", "Invalid JSON");
        return result;
    }

    QJsonObject root = doc.object();
    QJsonObject layerHintsJson = root["layers"].toObject();

    // Build a lookup from layer ID to model index
    std::function<QModelIndex(int, const QModelIndex&)> findById = [&](int id, const QModelIndex& parent) -> QModelIndex {
        for (int row = 0; row < psdData->exporterModel->rowCount(parent); ++row) {
            auto index = psdData->exporterModel->index(row, 0, parent);
            if (psdData->exporterModel->layerId(index) == id) return index;
            auto found = findById(id, index);
            if (found.isValid()) return found;
        }
        return {};
    };

    int restored = 0;
    for (const auto& idStr : layerHintsJson.keys()) {
        int layerId = idStr.toInt();
        QModelIndex index = findById(layerId, QModelIndex());
        if (!index.isValid()) continue;

        QVariantMap settings = layerHintsJson[idStr].toObject().toVariantMap();
        QStringList properties = settings.value("properties").toStringList();

        QPsdExporterTreeItemModel::ExportHint hint;
        hint.id = settings.value("id").toString();
        hint.type = static_cast<QPsdExporterTreeItemModel::ExportHint::Type>(settings.value("type").toInt());
        hint.componentName = settings.value("name").toString();
        hint.baseElement = static_cast<QPsdExporterTreeItemModel::ExportHint::NativeComponent>(settings.value("native").toInt());
        hint.visible = settings.value("visible").toBool();
        hint.properties = QSet<QString>(properties.begin(), properties.end());

        psdData->exporterModel->setLayerHint(index, hint);
        restored++;
    }

    result.set("restored", restored);
    return result;
}

// Set text content on a text layer (for runtime dynamic text updates)
val setLayerText(double handleD, int layerId, const std::string& text) {
    val result = val::object();
    int handle = static_cast<int>(handleD);

    if (handle < 1 || handle >= 16 || s_parsers[handle] == nullptr) {
        result.set("error", "Invalid parser handle");
        return result;
    }
    PsdData* psdData = s_parsers[handle];

    // Find layer by ID in widgetModel (scene uses this model for rendering)
    std::function<QModelIndex(const QModelIndex&)> findLayerById = [&](const QModelIndex& parent) -> QModelIndex {
        for (int row = 0; row < psdData->widgetModel->rowCount(parent); ++row) {
            auto index = psdData->widgetModel->index(row, 0, parent);
            if (psdData->widgetModel->layerId(index) == layerId) return index;
            auto found = findLayerById(index);
            if (found.isValid()) return found;
        }
        return {};
    };

    QModelIndex index = findLayerById(QModelIndex());
    if (!index.isValid()) {
        result.set("error", "Layer not found");
        return result;
    }

    const auto* item = psdData->widgetModel->layerItem(index);
    if (!item || item->type() != QPsdAbstractLayerItem::Text) {
        result.set("error", "Layer is not a text layer");
        return result;
    }

    // const_cast: QPsdTextItem::paint() reads runs() live on every render,
    // so mutating here is picked up by the next renderCompositeWithQt() call.
    auto* textItem = const_cast<QPsdTextLayerItem*>(
        static_cast<const QPsdTextLayerItem*>(item));

    auto runs = textItem->runs();
    if (runs.isEmpty()) {
        result.set("error", "Text layer has no runs");
        return result;
    }

    // Create new run with same styling as first run, but with new text
    QPsdTextLayerItem::Run newRun = runs.first();
    newRun.text = QString::fromStdString(text);

    QList<QPsdTextLayerItem::Run> newRuns;
    newRuns.append(newRun);
    textItem->setRuns(newRuns);

    result.set("ok", true);
    return result;
}

void releaseParser(double handleD) {
    int handle = static_cast<int>(handleD);
    if (handle >= 1 && handle < 16 && s_parsers[handle] != nullptr) {
        QFile::remove(s_parsers[handle]->tempPath);
        delete s_parsers[handle];
        s_parsers[handle] = nullptr;
    }
}

int main(int, char**) {
    ensureQtApp();
    return 0;
}

EMSCRIPTEN_BINDINGS(psdrun_qt) {
    function("allocateBuffer", &allocateBuffer);
    function("getBufferView", &getBufferView);
    function("parsePsd", &parsePsd);
    function("renderCompositeWithQt", &renderCompositeWithQt);
    function("getLayerImage", &getLayerImage);
    function("exportLayerJson", &exportLayerJson);
    function("getHintsJson", &getHintsJson);
    function("setHintsJson", &setHintsJson);
    function("setLayerText", &setLayerText);
    function("releaseParser", &releaseParser);
    // Font registration
    function("allocateFontBuffer", &allocateFontBuffer);
    function("getFontBufferView", &getFontBufferView);
    function("registerFont", &registerFont);
    function("getRegisteredFonts", &getRegisteredFonts);
}
