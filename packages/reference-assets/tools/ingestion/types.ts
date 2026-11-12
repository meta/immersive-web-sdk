/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Type definitions for code ingestion.
 */

export interface TypeScriptChunk {
  content: string;
  chunk_type:
    | 'function'
    | 'class'
    | 'interface'
    | 'type'
    | 'enum'
    | 'method'
    | 'const'
    | 'variable'
    | 'component'
    | 'system'
    | 'doc';
  name: string;
  start_line: number;
  end_line: number;
  file_path: string;
  language: 'typescript' | 'javascript' | 'markdown';
  module_path?: string;
  class_name?: string;
  imports: string[];
  exports: string[];
  type_parameters: string[];
  decorators: string[];
  calls: string[];
  extends: string[];
  implements: string[];
  uses_types: string[];
  ecs_component: boolean;
  ecs_system: boolean;
  webxr_api_usage: string[];
  three_js_usage: string[];
  semantic_labels: string[];
  source?: 'iwsdk' | 'elics' | 'deps';
}
