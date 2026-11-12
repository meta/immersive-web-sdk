/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * TypeScript/JavaScript parser using ts-morph.
 *
 * Extracts code chunks with semantic understanding using the TypeScript
 * compiler API. This is producer-only code and intentionally lives with the
 * ingestion pipeline rather than the runtime package.
 */

import * as path from 'path';
import {
  ClassDeclaration,
  EnumDeclaration,
  FunctionDeclaration,
  InterfaceDeclaration,
  MethodDeclaration,
  Node,
  Project,
  SourceFile,
  SyntaxKind,
  TypeAliasDeclaration,
} from 'ts-morph';
import { TypeScriptChunk } from './types.js';

type SourceLanguage = 'typescript' | 'javascript';

/**
 * The ECS factory a declaration's initializer calls (`createComponent` or
 * `createSystem`), also when a helper wraps it, e.g.
 * `setComponentEditorMetadata(createComponent(...), ...)`. Returns undefined
 * for other calls.
 */
function findECSFactoryName(call: Node, depth = 0): string | undefined {
  if (!Node.isCallExpression(call)) {
    return undefined;
  }
  const name = call.getExpression().getText();
  if (name.includes('createComponent') || name.includes('createSystem')) {
    return name;
  }
  if (depth >= 3) {
    return undefined;
  }
  for (const argument of call.getArguments()) {
    const found = findECSFactoryName(argument, depth + 1);
    if (found) {
      return found;
    }
  }
  return undefined;
}

export class TypeScriptParser {
  private project: Project;

  constructor() {
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
      },
    });
    console.error('✅ TypeScript/JavaScript parser initialized (ts-morph)');
  }

  parseFile(filePath: string): TypeScriptChunk[] {
    const sourceFile = this.project.addSourceFileAtPath(filePath);
    const chunks: TypeScriptChunk[] = [];
    const ext = path.extname(filePath);
    const language: SourceLanguage =
      ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript';
    const imports = this.extractImports(sourceFile);

    for (const cls of sourceFile.getClasses()) {
      chunks.push(...this.extractClass(cls, filePath, language, imports));
    }

    for (const func of sourceFile.getFunctions()) {
      chunks.push(this.extractFunction(func, filePath, language, imports));
    }

    for (const iface of sourceFile.getInterfaces()) {
      chunks.push(this.extractInterface(iface, filePath, language));
    }

    for (const typeAlias of sourceFile.getTypeAliases()) {
      chunks.push(this.extractTypeAlias(typeAlias, filePath, language));
    }

    for (const enumDecl of sourceFile.getEnums()) {
      chunks.push(this.extractEnum(enumDecl, filePath, language));
    }

    for (const varStatement of sourceFile.getVariableStatements()) {
      chunks.push(
        ...this.extractVariables(varStatement, filePath, language, imports),
      );
    }

    chunks.push(
      ...this.extractECSFactoryPatterns(
        sourceFile,
        filePath,
        language,
        imports,
      ),
    );

    this.project.removeSourceFile(sourceFile);
    return chunks;
  }

  private extractImports(sourceFile: SourceFile): string[] {
    const imports: string[] = [];

    for (const importDecl of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      const namedImports = importDecl
        .getNamedImports()
        .map((entry) => entry.getName());
      const defaultImport = importDecl.getDefaultImport()?.getText();

      if (defaultImport) {
        imports.push(`import ${defaultImport} from '${moduleSpecifier}'`);
      }
      if (namedImports.length > 0) {
        imports.push(
          `import { ${namedImports.join(', ')} } from '${moduleSpecifier}'`,
        );
      }
    }

    return imports;
  }

  private extractClass(
    cls: ClassDeclaration,
    filePath: string,
    language: SourceLanguage,
    imports: string[],
  ): TypeScriptChunk[] {
    const className = cls.getName() || 'AnonymousClass';
    const classChunk: TypeScriptChunk = {
      content: cls.getText(true),
      chunk_type: 'class',
      name: className,
      start_line: cls.getStartLineNumber(true),
      end_line: cls.getEndLineNumber(),
      file_path: filePath,
      language,
      imports,
      exports: cls.isExported() ? ['default', className] : [],
      type_parameters: cls.getTypeParameters().map((entry) => entry.getName()),
      decorators: cls.getDecorators().map((entry) => entry.getName()),
      calls: [],
      extends: cls.getExtends() ? [cls.getExtends()!.getText()] : [],
      implements: cls.getImplements().map((entry) => entry.getText()),
      uses_types: [],
      ecs_component: false,
      ecs_system: false,
      webxr_api_usage: this.detectWebXRUsage(cls.getText()),
      three_js_usage: this.detectThreeJsUsage(cls.getText()),
      semantic_labels: [],
    };

    if (this.isECSComponent(cls)) {
      classChunk.ecs_component = true;
      classChunk.semantic_labels.push('ecs-component');
    }
    if (this.isECSSystem(cls)) {
      classChunk.ecs_system = true;
      classChunk.semantic_labels.push('ecs-system');
    }

    const chunks = [classChunk];
    for (const method of cls.getMethods()) {
      chunks.push(
        this.extractMethod(method, filePath, language, className, imports),
      );
    }

    return chunks;
  }

  private extractFunction(
    func: FunctionDeclaration,
    filePath: string,
    language: SourceLanguage,
    imports: string[],
  ): TypeScriptChunk {
    const funcName = func.getName() || 'anonymous';
    return {
      content: func.getText(true),
      chunk_type: 'function',
      name: funcName,
      start_line: func.getStartLineNumber(true),
      end_line: func.getEndLineNumber(),
      file_path: filePath,
      language,
      imports,
      exports: func.isExported() ? [funcName] : [],
      type_parameters: func.getTypeParameters().map((entry) => entry.getName()),
      decorators: [],
      calls: this.extractFunctionCalls(func),
      extends: [],
      implements: [],
      uses_types: [],
      ecs_component: false,
      ecs_system: false,
      webxr_api_usage: this.detectWebXRUsage(func.getText()),
      three_js_usage: this.detectThreeJsUsage(func.getText()),
      semantic_labels: [],
    };
  }

  private extractMethod(
    method: MethodDeclaration,
    filePath: string,
    language: SourceLanguage,
    className: string,
    imports: string[],
  ): TypeScriptChunk {
    return {
      content: method.getText(true),
      chunk_type: 'method',
      name: `${className}.${method.getName()}`,
      start_line: method.getStartLineNumber(true),
      end_line: method.getEndLineNumber(),
      file_path: filePath,
      language,
      class_name: className,
      imports,
      exports: [],
      type_parameters: method
        .getTypeParameters()
        .map((entry) => entry.getName()),
      decorators: method.getDecorators().map((entry) => entry.getName()),
      calls: this.extractFunctionCalls(method),
      extends: [],
      implements: [],
      uses_types: [],
      ecs_component: false,
      ecs_system: false,
      webxr_api_usage: this.detectWebXRUsage(method.getText()),
      three_js_usage: this.detectThreeJsUsage(method.getText()),
      semantic_labels: [],
    };
  }

  private extractInterface(
    iface: InterfaceDeclaration,
    filePath: string,
    language: SourceLanguage,
  ): TypeScriptChunk {
    const name = iface.getName();
    return {
      content: iface.getText(true),
      chunk_type: 'interface',
      name,
      start_line: iface.getStartLineNumber(true),
      end_line: iface.getEndLineNumber(),
      file_path: filePath,
      language,
      imports: [],
      exports: iface.isExported() ? [name] : [],
      type_parameters: iface
        .getTypeParameters()
        .map((entry) => entry.getName()),
      decorators: [],
      calls: [],
      extends: iface.getExtends().map((entry) => entry.getText()),
      implements: [],
      uses_types: [],
      ecs_component: false,
      ecs_system: false,
      webxr_api_usage: [],
      three_js_usage: [],
      semantic_labels: [],
    };
  }

  private extractTypeAlias(
    typeAlias: TypeAliasDeclaration,
    filePath: string,
    language: SourceLanguage,
  ): TypeScriptChunk {
    const name = typeAlias.getName();
    return {
      content: typeAlias.getText(true),
      chunk_type: 'type',
      name,
      start_line: typeAlias.getStartLineNumber(true),
      end_line: typeAlias.getEndLineNumber(),
      file_path: filePath,
      language,
      imports: [],
      exports: typeAlias.isExported() ? [name] : [],
      type_parameters: typeAlias
        .getTypeParameters()
        .map((entry) => entry.getName()),
      decorators: [],
      calls: [],
      extends: [],
      implements: [],
      uses_types: [],
      ecs_component: false,
      ecs_system: false,
      webxr_api_usage: [],
      three_js_usage: [],
      semantic_labels: [],
    };
  }

  private extractEnum(
    enumDecl: EnumDeclaration,
    filePath: string,
    language: SourceLanguage,
  ): TypeScriptChunk {
    const name = enumDecl.getName();
    return {
      content: enumDecl.getText(true),
      chunk_type: 'enum',
      name,
      start_line: enumDecl.getStartLineNumber(true),
      end_line: enumDecl.getEndLineNumber(),
      file_path: filePath,
      language,
      imports: [],
      exports: enumDecl.isExported() ? [name] : [],
      type_parameters: [],
      decorators: [],
      calls: [],
      extends: [],
      implements: [],
      uses_types: [],
      ecs_component: false,
      ecs_system: false,
      webxr_api_usage: [],
      three_js_usage: [],
      semantic_labels: [],
    };
  }

  private extractVariables(
    varStatement: any,
    filePath: string,
    language: SourceLanguage,
    imports: string[],
  ): TypeScriptChunk[] {
    const chunks: TypeScriptChunk[] = [];

    for (const declaration of varStatement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer || initializer.getText().length <= 20) {
        continue;
      }

      chunks.push({
        content: varStatement.getText(true),
        chunk_type:
          initializer.getKind() === SyntaxKind.ArrowFunction ||
          initializer.getKind() === SyntaxKind.FunctionExpression
            ? 'function'
            : 'const',
        name: declaration.getName(),
        start_line: varStatement.getStartLineNumber(true),
        end_line: varStatement.getEndLineNumber(),
        file_path: filePath,
        language,
        imports,
        exports: varStatement.isExported() ? [declaration.getName()] : [],
        type_parameters: [],
        decorators: [],
        calls: [],
        extends: [],
        implements: [],
        uses_types: [],
        ecs_component: false,
        ecs_system: false,
        webxr_api_usage: this.detectWebXRUsage(varStatement.getText()),
        three_js_usage: this.detectThreeJsUsage(varStatement.getText()),
        semantic_labels: [],
      });
    }

    return chunks;
  }

  private extractFunctionCalls(node: Node): string[] {
    const calls: string[] = [];
    node.forEachDescendant((descendant) => {
      if (Node.isCallExpression(descendant)) {
        calls.push(descendant.getExpression().getText());
      }
    });
    return calls;
  }

  private isECSComponent(cls: ClassDeclaration): boolean {
    const name = cls.getName() || '';
    const extendsText = cls.getExtends()?.getText() || '';
    const extendsComponent = /\b\w*Component\b/.test(
      extendsText.split(/[.(]/)[0],
    );
    const hasComponentDecorator = cls
      .getDecorators()
      .some((entry) => entry.getName().toLowerCase().includes('component'));

    if (name.endsWith('System')) {
      return false;
    }

    return extendsComponent || hasComponentDecorator;
  }

  private isECSSystem(cls: ClassDeclaration): boolean {
    const name = cls.getName() || '';
    const extendsText = cls.getExtends()?.getText() || '';
    const extendsSystem = /\bSystem\b/.test(extendsText);
    return extendsSystem || name.endsWith('System');
  }

  private detectWebXRUsage(text: string): string[] {
    const webxrAPIs = [
      'XRSession',
      'XRFrame',
      'XRReferenceSpace',
      'XRView',
      'XRViewport',
      'XRPose',
      'XRRigidTransform',
      'XRInputSource',
      'XRHand',
      'XRHitTestResult',
      'XRLayer',
      'XRWebGLLayer',
      'XRAnchor',
      'XRPlane',
      'XRMesh',
      'requestSession',
      'requestAnimationFrame',
      'requestReferenceSpace',
    ];

    return webxrAPIs.filter((entry) => text.includes(entry));
  }

  private detectThreeJsUsage(text: string): string[] {
    const threeAPIs = [
      'THREE.',
      'Scene',
      'PerspectiveCamera',
      'WebGLRenderer',
      'Mesh',
      'Geometry',
      'Material',
      'Texture',
      'Light',
      'Object3D',
    ];

    return threeAPIs.filter((entry) => text.includes(entry));
  }

  private extractECSFactoryPatterns(
    sourceFile: SourceFile,
    filePath: string,
    language: SourceLanguage,
    imports: string[],
  ): TypeScriptChunk[] {
    const chunks: TypeScriptChunk[] = [];

    for (const varStatement of sourceFile.getVariableStatements()) {
      for (const declaration of varStatement.getDeclarations()) {
        const initializer = declaration.getInitializer();
        if (!initializer || !Node.isCallExpression(initializer)) {
          continue;
        }

        const functionName = findECSFactoryName(initializer);
        if (!functionName) {
          continue;
        }
        const isComponent = functionName.includes('createComponent');
        const isSystem = !isComponent;

        const name = declaration.getName();
        chunks.push({
          content: varStatement.getText(true),
          chunk_type: isComponent ? 'component' : 'system',
          name,
          start_line: varStatement.getStartLineNumber(true),
          end_line: varStatement.getEndLineNumber(),
          file_path: filePath,
          language,
          imports,
          exports: varStatement.isExported() ? [name] : [],
          type_parameters: [],
          decorators: [],
          calls: [functionName],
          extends: isComponent ? ['Component'] : ['System'],
          implements: [],
          uses_types: [],
          ecs_component: isComponent,
          ecs_system: isSystem,
          webxr_api_usage: this.detectWebXRUsage(varStatement.getText()),
          three_js_usage: this.detectThreeJsUsage(varStatement.getText()),
          semantic_labels: [isComponent ? 'ecs-component' : 'ecs-system'],
        });
      }
    }

    return chunks;
  }
}
