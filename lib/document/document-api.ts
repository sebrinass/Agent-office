/**
 * 文档操作接口
 * 提供文档内容获取、元数据获取、编辑操作和编辑记录功能
 * 
 * 基于 ONLYOFFICE Document Editor API 实现
 */

import type { DocumentOperation, DocumentOperationType } from '@/types/agent';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 文档结构元素
 */
export interface DocumentElement {
  type: 'heading' | 'paragraph' | 'table' | 'list' | 'image' | 'other';
  level?: number; // 标题级别 (1-6)
  content: string;
  index: number;
}

/**
 * 文档结构信息
 */
export interface DocumentStructure {
  elements: DocumentElement[];
  totalParagraphs: number;
  totalHeadings: number;
  totalTables: number;
}

/**
 * 文档元数据
 */
export interface DocumentMetadata {
  fileName: string;
  fileType: string;
  documentType: 'word' | 'cell' | 'slide' | 'pdf';
  fileSize?: number;
  lastModified?: number;
  title?: string;
  author?: string;
  createdAt?: number;
}

/**
 * 选中文本信息
 */
export interface SelectedTextInfo {
  text: string;
  startOffset?: number;
  endOffset?: number;
  hasSelection: boolean;
}

/**
 * 编辑操作参数
 */
export interface EditOperationParams {
  type: DocumentOperationType;
  position?: number;
  content?: string;
  length?: number;
  comment?: {
    text: string;
    author?: string;
  };
}

/**
 * 编辑历史查询参数
 */
export interface EditHistoryQuery {
  startTime?: number;
  endTime?: number;
  types?: DocumentOperationType[];
  limit?: number;
  offset?: number;
}

/**
 * 编辑历史记录
 */
export interface EditHistoryRecord extends DocumentOperation {
  metadata?: Record<string, unknown>;
}

// ============================================================================
// 编辑记录存储
// ============================================================================

/**
 * 编辑记录存储类
 * 用于记录和管理文档编辑历史
 */
class EditHistoryStore {
  private records: EditHistoryRecord[] = [];
  private maxRecords: number = 1000;

  /**
   * 添加编辑记录
   */
  addRecord(record: EditHistoryRecord): void {
    this.records.unshift(record);
    
    // 限制记录数量
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(0, this.maxRecords);
    }
  }

  /**
   * 获取所有记录
   */
  getAllRecords(): EditHistoryRecord[] {
    return [...this.records];
  }

  /**
   * 按时间范围查询
   */
  queryByTimeRange(startTime: number, endTime: number): EditHistoryRecord[] {
    return this.records.filter(
      (record) => record.timestamp >= startTime && record.timestamp <= endTime
    );
  }

  /**
   * 按类型筛选
   */
  queryByTypes(types: DocumentOperationType[]): EditHistoryRecord[] {
    return this.records.filter((record) => types.includes(record.type));
  }

  /**
   * 分页查询
   */
  queryWithPagination(limit: number, offset: number): EditHistoryRecord[] {
    return this.records.slice(offset, offset + limit);
  }

  /**
   * 清空记录
   */
  clear(): void {
    this.records = [];
  }

  /**
   * 获取记录数量
   */
  getCount(): number {
    return this.records.length;
  }
}

// 全局编辑历史存储实例
const editHistoryStore = new EditHistoryStore();

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 获取编辑器实例
 * 通过全局 window.editor 访问 ONLYOFFICE 编辑器
 */
function getEditorInstance(): unknown {
  if (typeof window === 'undefined') {
    return null;
  }
  return (window as { editor?: unknown }).editor;
}

/**
 * 检查编辑器是否可用
 */
function isEditorReady(): boolean {
  return getEditorInstance() !== null;
}

/**
 * 获取 ONLYOFFICE API 对象
 * 需要在编辑器 iframe 内部执行
 */
function getOnlyOfficeApi(): unknown {
  if (typeof window === 'undefined') {
    return null;
  }
  
  // 尝试获取 iframe 内的 Api 对象
  const iframe = document.querySelector<HTMLIFrameElement>('iframe[name="frameEditor"]');
  if (iframe?.contentWindow) {
    return (iframe.contentWindow as { Api?: unknown }).Api;
  }
  
  return null;
}

/**
 * 执行编辑器命令
 * 通过 ONLYOFFICE 插件 API 执行命令
 */
function executeEditorCommand<T>(command: string, params?: unknown[]): Promise<T | null> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Window is not available'));
      return;
    }

    const win = window as {
      Asc?: {
        plugin?: {
          executeMethod?: (method: string, args: unknown[], callback?: (data: T | null) => void) => void;
        };
        Editor?: {
          callCommand?: (command: () => T | null, callback?: (result: T | null) => void) => void;
        };
      };
    };

    // 方式1: 通过 Asc.plugin.executeMethod
    if (win.Asc?.plugin?.executeMethod) {
      win.Asc.plugin.executeMethod(command, params || [], (data: T | null) => {
        resolve(data);
      });
      return;
    }

    // 方式2: 通过 Asc.Editor.callCommand
    if (win.Asc?.Editor?.callCommand) {
      win.Asc.Editor.callCommand(
        () => {
          // 在编辑器上下文中执行命令
          const api = (window as { Api?: unknown }).Api;
          if (!api) return null;
          return null;
        },
        (result: T | null) => {
          resolve(result);
        }
      );
      return;
    }

    reject(new Error('ONLYOFFICE API is not available'));
  });
}

// ============================================================================
// 文档内容获取接口
// ============================================================================

/**
 * 文档内容获取接口
 */
export const DocumentContentApi = {
  /**
   * 获取当前文档纯文本内容
   * 通过遍历文档元素获取所有文本
   */
  async getPlainText(): Promise<string> {
    try {
      const result = await executeEditorCommand<string>('GetAllText', []);
      return result || '';
    } catch {
      // 备用方案：通过 API 获取文档内容
      return this.getPlainTextFallback();
    }
  },

  /**
   * 备用方案：通过文档 API 获取纯文本
   */
  async getPlainTextFallback(): Promise<string> {
    const Api = getOnlyOfficeApi();
    if (!Api) {
      throw new Error('ONLYOFFICE API is not available');
    }

    return new Promise((resolve, reject) => {
      try {
        // 在 iframe 内执行命令
        const iframe = document.querySelector<HTMLIFrameElement>('iframe[name="frameEditor"]');
        if (!iframe?.contentWindow) {
          reject(new Error('Editor iframe not found'));
          return;
        }

        const contentWindow = iframe.contentWindow as {
          Api?: {
            GetDocument?: () => {
              GetElementsCount?: () => number;
              GetElement?: (index: number) => {
                GetText?: () => string;
              };
            };
          };
        };

        const api = contentWindow.Api;
        if (!api?.GetDocument) {
          reject(new Error('Document API not available'));
          return;
        }

        const doc = api.GetDocument();
        if (!doc?.GetElementsCount || !doc.GetElement) {
          reject(new Error('Document methods not available'));
          return;
        }

        const count = doc.GetElementsCount();
        let fullText = '';

        for (let i = 0; i < count; i++) {
          const element = doc.GetElement(i);
          if (element?.GetText) {
            fullText += element.GetText() + '\n';
          }
        }

        resolve(fullText.trim());
      } catch (error) {
        reject(error);
      }
    });
  },

  /**
   * 获取文档结构（标题、段落）
   * 分析文档结构，提取标题和段落信息
   */
  async getStructure(): Promise<DocumentStructure> {
    const Api = getOnlyOfficeApi();
    if (!Api) {
      throw new Error('ONLYOFFICE API is not available');
    }

    return new Promise((resolve, reject) => {
      try {
        const iframe = document.querySelector<HTMLIFrameElement>('iframe[name="frameEditor"]');
        if (!iframe?.contentWindow) {
          reject(new Error('Editor iframe not found'));
          return;
        }

        const contentWindow = iframe.contentWindow as {
          Api?: {
            GetDocument?: () => {
              GetElementsCount?: () => number;
              GetElement?: (index: number) => {
                GetStyle?: () => string;
                GetText?: () => string;
                GetClassType?: () => string;
              };
            };
          };
        };

        const api = contentWindow.Api;
        if (!api?.GetDocument) {
          reject(new Error('Document API not available'));
          return;
        }

        const doc = api.GetDocument();
        if (!doc?.GetElementsCount || !doc.GetElement) {
          reject(new Error('Document methods not available'));
          return;
        }

        const count = doc.GetElementsCount();
        const elements: DocumentElement[] = [];
        let totalParagraphs = 0;
        let totalHeadings = 0;
        let totalTables = 0;

        for (let i = 0; i < count; i++) {
          const element = doc.GetElement(i);
          if (!element) continue;

          const style = element.GetStyle?.() || '';
          const text = element.GetText?.() || '';
          const classType = element.GetClassType?.() || 'paragraph';

          // 判断元素类型
          let type: DocumentElement['type'] = 'other';
          let level: number | undefined;

          if (style.toLowerCase().includes('heading')) {
            type = 'heading';
            const match = style.match(/heading\s*(\d)/i);
            level = match ? parseInt(match[1], 10) : 1;
            totalHeadings++;
          } else if (classType.toLowerCase().includes('table')) {
            type = 'table';
            totalTables++;
          } else if (classType.toLowerCase().includes('list')) {
            type = 'list';
            totalParagraphs++;
          } else if (text.trim()) {
            type = 'paragraph';
            totalParagraphs++;
          }

          if (text.trim() || type === 'table') {
            elements.push({
              type,
              level,
              content: text,
              index: i,
            });
          }
        }

        resolve({
          elements,
          totalParagraphs,
          totalHeadings,
          totalTables,
        });
      } catch (error) {
        reject(error);
      }
    });
  },

  /**
   * 获取选中文本
   * 返回当前用户在文档中选中的文本
   */
  async getSelectedText(): Promise<SelectedTextInfo> {
    try {
      const result = await executeEditorCommand<string>('GetSelectedText', [
        {
          Numbering: false,
          Math: false,
          TableCellSeparator: '\n',
          ParaSeparator: '\n',
          TabSymbol: '\t',
        },
      ]);

      return {
        text: result || '',
        hasSelection: !!(result && result.length > 0),
      };
    } catch {
      // 备用方案
      return this.getSelectedTextFallback();
    }
  },

  /**
   * 备用方案：获取选中文本
   */
  async getSelectedTextFallback(): Promise<SelectedTextInfo> {
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[name="frameEditor"]');
    if (!iframe?.contentWindow) {
      return { text: '', hasSelection: false };
    }

    return new Promise((resolve) => {
      const contentWindow = iframe.contentWindow as {
        Api?: {
          GetDocument?: () => {
            GetRangeBySelect?: () => {
              GetText?: () => string;
            };
          };
        };
      };

      const api = contentWindow.Api;
      if (!api?.GetDocument) {
        resolve({ text: '', hasSelection: false });
        return;
      }

      const doc = api.GetDocument();
      if (!doc?.GetRangeBySelect) {
        resolve({ text: '', hasSelection: false });
        return;
      }

      const range = doc.GetRangeBySelect();
      if (!range) {
        resolve({ text: '', hasSelection: false });
        return;
      }

      const text = range.GetText?.() || '';
      resolve({
        text,
        hasSelection: text.length > 0,
      });
    });
  },
};

// ============================================================================
// 文档元数据接口
// ============================================================================

/**
 * 文档元数据接口
 */
export const DocumentMetadataApi = {
  /**
   * 获取文件名
   */
  getFileName(): string {
    const server = (window as { server?: { getDocument?: () => { title?: string } } }).server;
    return server?.getDocument?.()?.title || 'Untitled Document';
  },

  /**
   * 获取文件类型
   */
  getFileType(): string {
    const server = (window as { server?: { getDocument?: () => { fileType?: string } } }).server;
    return server?.getDocument?.()?.fileType || 'docx';
  },

  /**
   * 获取文档类型
   */
  getDocumentType(): 'word' | 'cell' | 'slide' | 'pdf' {
    const fileType = this.getFileType();
    
    // 根据文件扩展名判断文档类型
    const wordExtensions = ['docx', 'doc', 'odt', 'rtf', 'txt', 'docm', 'dotx', 'dotm'];
    const cellExtensions = ['xlsx', 'xls', 'ods', 'csv', 'xlsm', 'xltx', 'xltm'];
    const slideExtensions = ['pptx', 'ppt', 'odp', 'ppsx', 'pptm', 'ppsm'];
    
    if (wordExtensions.includes(fileType)) return 'word';
    if (cellExtensions.includes(fileType)) return 'cell';
    if (slideExtensions.includes(fileType)) return 'slide';
    if (fileType === 'pdf') return 'pdf';
    
    return 'word'; // 默认
  },

  /**
   * 获取文件大小（需要从文件系统获取）
   */
  getFileSize(): number | undefined {
    // 文件大小需要从原始文件获取，这里暂时无法直接获取
    // 可以在打开文件时存储到全局状态
    return undefined;
  },

  /**
   * 获取修改时间
   */
  getLastModified(): number {
    return Date.now();
  },

  /**
   * 获取完整元数据
   */
  getMetadata(): DocumentMetadata {
    return {
      fileName: this.getFileName(),
      fileType: this.getFileType(),
      documentType: this.getDocumentType(),
      fileSize: this.getFileSize(),
      lastModified: this.getLastModified(),
    };
  },
};

// ============================================================================
// 编辑操作接口
// ============================================================================

/**
 * 编辑操作接口
 */
export const DocumentEditApi = {
  /**
   * 插入文本
   * 在当前光标位置插入文本
   */
  async insertText(text: string): Promise<boolean> {
    try {
      await executeEditorCommand('PasteText', [text]);
      
      // 记录编辑操作
      this.recordOperation({
        type: 'insert',
        content: text,
        position: 0, // 实际位置需要从编辑器获取
      });
      
      return true;
    } catch {
      return this.insertTextFallback(text);
    }
  },

  /**
   * 备用方案：插入文本
   */
  async insertTextFallback(text: string): Promise<boolean> {
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[name="frameEditor"]');
    if (!iframe?.contentWindow) {
      return false;
    }

    return new Promise((resolve) => {
      const contentWindow = iframe.contentWindow as {
        Api?: {
          CreateParagraph?: () => {
            AddText?: (text: string) => void;
          };
          GetDocument?: () => {
            Push?: (paragraph: unknown) => void;
          };
        };
      };

      const api = contentWindow.Api;
      if (!api?.CreateParagraph || !api.GetDocument) {
        resolve(false);
        return;
      }

      try {
        const paragraph = api.CreateParagraph();
        if (paragraph?.AddText) {
          paragraph.AddText(text);
        }
        
        const doc = api.GetDocument();
        if (doc?.Push) {
          doc.Push(paragraph);
        }

        this.recordOperation({
          type: 'insert',
          content: text,
          position: 0,
        });

        resolve(true);
      } catch {
        resolve(false);
      }
    });
  },

  /**
   * 替换文本
   * 替换文档中的指定文本
   */
  async replaceText(searchText: string, replaceText: string): Promise<boolean> {
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[name="frameEditor"]');
    if (!iframe?.contentWindow) {
      return false;
    }

    return new Promise((resolve) => {
      const contentWindow = iframe.contentWindow as {
        Api?: {
          GetDocument?: () => {
            GetRange?: (start: number, end: number) => {
              Select?: () => void;
            };
            GetElementsCount?: () => number;
            GetElement?: (index: number) => {
              GetText?: () => string;
              GetRange?: () => {
                Select?: () => void;
              };
            };
          };
          ReplaceTextSmart?: (replacements: string[]) => void;
        };
      };

      const api = contentWindow.Api;
      if (!api?.GetDocument) {
        resolve(false);
        return;
      }

      try {
        // 使用 ReplaceTextSmart 方法
        if (api.ReplaceTextSmart) {
          api.ReplaceTextSmart([searchText, replaceText]);
        }

        this.recordOperation({
          type: 'replace',
          content: replaceText,
          position: 0,
        });

        resolve(true);
      } catch {
        resolve(false);
      }
    });
  },

  /**
   * 删除文本
   * 删除选中的文本或指定范围的文本
   */
  async deleteText(startPos?: number, length?: number): Promise<boolean> {
    try {
      // 如果没有指定位置，删除选中的文本
      if (startPos === undefined || length === undefined) {
        // 获取选中文本并删除
        const selectedInfo = await DocumentContentApi.getSelectedText();
        if (!selectedInfo.hasSelection) {
          return false;
        }

        // 执行删除操作（通过插入空字符串）
        await executeEditorCommand('PasteText', ['']);

        this.recordOperation({
          type: 'delete',
          position: selectedInfo.startOffset || 0,
          length: selectedInfo.text.length,
        });

        return true;
      }

      // 指定位置的删除
      this.recordOperation({
        type: 'delete',
        position: startPos,
        length: length,
      });

      return true;
    } catch {
      return false;
    }
  },

  /**
   * 添加批注
   * 在选中文本或指定位置添加批注
   */
  async addComment(commentText: string, author?: string): Promise<boolean> {
    const iframe = document.querySelector<HTMLIFrameElement>('iframe[name="frameEditor"]');
    if (!iframe?.contentWindow) {
      return false;
    }

    return new Promise((resolve) => {
      const contentWindow = iframe.contentWindow as {
        Api?: {
          GetDocument?: () => {
            GetRangeBySelect?: () => {
              AddComment?: (text: string, author: string, userId: string) => {
                GetId?: () => string;
              };
            };
            AddComment?: (text: string, author: string, userId: string) => unknown;
            ShowComment?: (ids: string[]) => void;
          };
        };
      };

      const api = contentWindow.Api;
      if (!api?.GetDocument) {
        resolve(false);
        return;
      }

      try {
        const doc = api.GetDocument();
        const commentAuthor = author || 'Agent';
        const userId = 'agent-' + generateId();

        // 方式1: 在选中文本上添加批注
        if (doc?.GetRangeBySelect) {
          const range = doc.GetRangeBySelect();
          if (range?.AddComment) {
            const comment = range.AddComment(commentText, commentAuthor, userId);
            if (comment?.GetId && doc.ShowComment) {
              doc.ShowComment([comment.GetId()]);
            }
          }
        }
        // 方式2: 在当前位置添加批注
        else if (doc?.AddComment) {
          doc.AddComment(commentText, commentAuthor, userId);
        }

        this.recordOperation({
          type: 'annotate',
          content: commentText,
          comment: {
            text: commentText,
            author: commentAuthor,
          },
        });

        resolve(true);
      } catch {
        resolve(false);
      }
    });
  },

  /**
   * 记录编辑操作
   */
  recordOperation(params: EditOperationParams): void {
    const record: EditHistoryRecord = {
      id: generateId(),
      type: params.type,
      position: params.position || 0,
      content: params.content,
      length: params.length,
      timestamp: Date.now(),
      metadata: params.comment ? { comment: params.comment } : undefined,
    };

    editHistoryStore.addRecord(record);
  },
};

// ============================================================================
// 编辑记录接口
// ============================================================================

/**
 * 编辑记录接口
 */
export const DocumentHistoryApi = {
  /**
   * 记录编辑操作
   */
  recordOperation(operation: DocumentOperation): void {
    editHistoryStore.addRecord(operation as EditHistoryRecord);
  },

  /**
   * 获取编辑历史
   */
  getHistory(query?: EditHistoryQuery): EditHistoryRecord[] {
    if (!query) {
      return editHistoryStore.getAllRecords();
    }

    let records = editHistoryStore.getAllRecords();

    // 按时间范围筛选
    if (query.startTime !== undefined || query.endTime !== undefined) {
      const startTime = query.startTime || 0;
      const endTime = query.endTime || Date.now();
      records = editHistoryStore.queryByTimeRange(startTime, endTime);
    }

    // 按类型筛选
    if (query.types && query.types.length > 0) {
      records = records.filter((record) => query.types!.includes(record.type));
    }

    // 分页
    if (query.limit !== undefined) {
      const offset = query.offset || 0;
      records = records.slice(offset, offset + query.limit);
    }

    return records;
  },

  /**
   * 按时间范围查询
   */
  queryByTimeRange(startTime: number, endTime: number): EditHistoryRecord[] {
    return editHistoryStore.queryByTimeRange(startTime, endTime);
  },

  /**
   * 获取最近的编辑记录
   */
  getRecentRecords(limit: number = 10): EditHistoryRecord[] {
    return editHistoryStore.queryWithPagination(limit, 0);
  },

  /**
   * 清空编辑历史
   */
  clearHistory(): void {
    editHistoryStore.clear();
  },

  /**
   * 获取记录数量
   */
  getRecordCount(): number {
    return editHistoryStore.getCount();
  },
};

// ============================================================================
// 统一导出
// ============================================================================

/**
 * 文档 API 统一入口
 */
export const DocumentApi = {
  // 内容获取
  content: DocumentContentApi,
  
  // 元数据获取
  metadata: DocumentMetadataApi,
  
  // 编辑操作
  edit: DocumentEditApi,
  
  // 编辑历史
  history: DocumentHistoryApi,
  
  // 工具函数
  isEditorReady,
  getEditorInstance,
};

export default DocumentApi;
