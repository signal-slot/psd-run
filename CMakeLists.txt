# Copyright (C) 2026 Signal Slot Inc.
# SPDX-License-Identifier: LGPL-3.0-only OR GPL-2.0-only OR GPL-3.0-only

cmake_minimum_required(VERSION 3.21)

project(psdrun VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Core CorePrivate Gui GuiPrivate Widgets BuildInternals)

add_subdirectory(qtpsd)

# Main thread Qt rendering module with PsdExporter for hints
qt_add_executable(psdrun_qt
    src/wasm/psdrun_qt.cpp
)

target_link_libraries(psdrun_qt PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::GuiPrivate
    Qt6::Widgets
    Qt6::PsdCore
    Qt6::PsdGui
    Qt6::PsdWidget
    Qt6::PsdExporter
)

if(EMSCRIPTEN)
    # Link static plugins for WASM builds
    # Additional Layer Information plugins
    target_link_libraries(psdrun_qt PRIVATE
        QPsdAdditionalLayerInformationAnnoPlugin
        QPsdAdditionalLayerInformationBlncPlugin
        QPsdAdditionalLayerInformationBritPlugin
        QPsdAdditionalLayerInformationBrstPlugin
        QPsdAdditionalLayerInformationClrlPlugin
        QPsdAdditionalLayerInformationCurvPlugin
        QPsdAdditionalLayerInformationDataPlugin
        QPsdAdditionalLayerInformationExpaPlugin
        QPsdAdditionalLayerInformationFeidPlugin
        QPsdAdditionalLayerInformationFMskPlugin
        QPsdAdditionalLayerInformationGrdmPlugin
        QPsdAdditionalLayerInformationHue2Plugin
        QPsdAdditionalLayerInformationLclrPlugin
        QPsdAdditionalLayerInformationLevlPlugin
        QPsdAdditionalLayerInformationLfx2Plugin
        QPsdAdditionalLayerInformationLMskPlugin
        QPsdAdditionalLayerInformationLnk_Plugin
        QPsdAdditionalLayerInformationLr16Plugin
        QPsdAdditionalLayerInformationLrFXPlugin
        QPsdAdditionalLayerInformationLsctPlugin
        QPsdAdditionalLayerInformationLsdkPlugin
        QPsdAdditionalLayerInformationLuniPlugin
        QPsdAdditionalLayerInformationMixrPlugin
        QPsdAdditionalLayerInformationNonePlugin
        QPsdAdditionalLayerInformationPattPlugin
        QPsdAdditionalLayerInformationPhflPlugin
        QPsdAdditionalLayerInformationPlLdPlugin
        QPsdAdditionalLayerInformationQpointFPlugin
        QPsdAdditionalLayerInformationSelcPlugin
        QPsdAdditionalLayerInformationShmdPlugin
        QPsdAdditionalLayerInformationSoLdPlugin
        QPsdAdditionalLayerInformationTyShPlugin
        QPsdAdditionalLayerInformationU8Plugin
        QPsdAdditionalLayerInformationU16Plugin
        QPsdAdditionalLayerInformationU32Plugin
        QPsdAdditionalLayerInformationUnknownPlugin
        QPsdAdditionalLayerInformationV16DescriptorPlugin
        QPsdAdditionalLayerInformationVmskPlugin
        QPsdAdditionalLayerInformationVogkPlugin
        QPsdAdditionalLayerInformationVscgPlugin
        QPsdAdditionalLayerInformationVstkPlugin
    )
    # Descriptor plugins
    target_link_libraries(psdrun_qt PRIVATE
        QPsdDescriptorBoolPlugin
        QPsdDescriptorDoubPlugin
        QPsdDescriptorEnumPlugin
        QPsdDescriptorLongPlugin
        QPsdDescriptorObArPlugin
        QPsdDescriptorObjPlugin
        QPsdDescriptorObjcPlugin
        QPsdDescriptorPthPlugin
        QPsdDescriptorTdtaPlugin
        QPsdDescriptorTextPlugin
        QPsdDescriptorUntFPlugin
        QPsdDescriptorVlLsPlugin
    )
    # Effects layer plugins
    target_link_libraries(psdrun_qt PRIVATE
        QPsdEffectsLayerBevlPlugin
        QPsdEffectsLayerCmnSPlugin
        QPsdEffectsLayerIglwPlugin
        QPsdEffectsLayerOglwPlugin
        QPsdEffectsLayerShadowPlugin
        QPsdEffectsLayerSofiPlugin
    )
endif()

if(EMSCRIPTEN)
    target_link_options(psdrun_qt PRIVATE
        -sWASM=1
        -sMODULARIZE=1
        -sEXPORT_NAME='PsdRunModule'
        -sALLOW_MEMORY_GROWTH=1
        -sMAXIMUM_MEMORY=4GB
        -sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','wasmMemory']
        -sEXPORTED_FUNCTIONS=['_main','_malloc','_free']
        -sENVIRONMENT=web
        -sNO_EXIT_RUNTIME=1
        -sNO_DISABLE_EXCEPTION_CATCHING
        --bind
    )
endif()
