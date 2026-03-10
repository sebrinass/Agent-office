/**
 * IndexedDB 文档存储模块
 * 用于本地持久化存储文档，解决刷新后丢失问题
 */

const DB_NAME = "office-documents";
const DB_VERSION = 1;
const STORE_NAME = "documents";

export interface StoredDocument {
  id: string;           // 唯一ID
  name: string;         // 文件名
  type: string;         // 文件类型 (docx, xlsx, pptx, pdf)
  size: number;         // 文件大小
  content: ArrayBuffer; // 文档二进制内容
  createdAt: number;    // 存储时间
}

let dbInstance: IDBDatabase | null = null;

/**
 * 获取 IndexedDB 实例
 */
function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error("无法打开 IndexedDB"));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // 创建文档存储表
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("type", "type", { unique: false });
      }
    };
  });
}

/**
 * 生成唯一文档ID
 */
export function generateDocumentId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `${timestamp}-${random}`;
}

/**
 * 保存文档到 IndexedDB
 */
export async function saveDocument(
  file: File,
  content: ArrayBuffer
): Promise<string> {
  const db = await getDB();
  const id = generateDocumentId();
  
  const doc: StoredDocument = {
    id,
    name: file.name,
    type: getFileType(file.name),
    size: file.size,
    content,
    createdAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(doc);

    request.onsuccess = () => {
      console.log(`[DocumentStorage] 文档已保存: ${id}`);
      resolve(id);
    };

    request.onerror = () => {
      reject(new Error("保存文档失败"));
    };
  });
}

/**
 * 从 IndexedDB 加载文档
 */
export async function loadDocument(id: string): Promise<StoredDocument | null> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      if (request.result) {
        console.log(`[DocumentStorage] 文档已加载: ${id}`);
        resolve(request.result);
      } else {
        resolve(null);
      }
    };

    request.onerror = () => {
      reject(new Error("加载文档失败"));
    };
  });
}

/**
 * 删除文档
 */
export async function deleteDocument(id: string): Promise<void> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => {
      console.log(`[DocumentStorage] 文档已删除: ${id}`);
      resolve();
    };

    request.onerror = () => {
      reject(new Error("删除文档失败"));
    };
  });
}

/**
 * 获取所有文档列表（不含内容）
 */
export async function listDocuments(): Promise<Omit<StoredDocument, "content">[]> {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const docs = request.result.map((doc: StoredDocument) => ({
        id: doc.id,
        name: doc.name,
        type: doc.type,
        size: doc.size,
        createdAt: doc.createdAt,
      }));
      resolve(docs);
    };

    request.onerror = () => {
      reject(new Error("获取文档列表失败"));
    };
  });
}

/**
 * 清理过期文档（超过7天）
 */
export async function cleanupOldDocuments(daysToKeep: number = 7): Promise<number> {
  const db = await getDB();
  const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index("createdAt");
    const range = IDBKeyRange.upperBound(cutoffTime);
    const request = index.openCursor(range);
    let deletedCount = 0;

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        deletedCount++;
        cursor.continue();
      } else {
        console.log(`[DocumentStorage] 已清理 ${deletedCount} 个过期文档`);
        resolve(deletedCount);
      }
    };

    request.onerror = () => {
      reject(new Error("清理文档失败"));
    };
  });
}

/**
 * 从文件名获取文件类型
 */
function getFileType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return ext;
}

/**
 * 从 ArrayBuffer 创建 File 对象
 */
export function createFileFromDocument(doc: StoredDocument): File {
  const mimeTypes: Record<string, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    pdf: "application/pdf",
  };

  const mimeType = mimeTypes[doc.type] || "application/octet-stream";
  return new File([doc.content], doc.name, { type: mimeType });
}
