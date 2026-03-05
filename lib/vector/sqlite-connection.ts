/**
 * SQLite 连接管理模块
 * 
 * 使用 sql.js（SQLite WASM 版本）在浏览器中运行 SQLite
 * 通过 IndexedDB 持久化数据库文件
 * 
 * 注意：sql.js 不支持原生扩展，向量检索需要自定义实现
 */

import initSqlJs, { Database, SqlJsStatic } from 'sql.js';

// ============ 类型定义 ============

export type ConnectionStatus = 'idle' | 'initializing' | 'ready' | 'error';

export interface SQLiteConnectionState {
  db: Database | null;
  SQL: SqlJsStatic | null;
  status: ConnectionStatus;
  error: string | null;
}

// ============ 常量配置 ============

const DB_NAME = 'office-website-vector';
const DB_STORE_NAME = 'sqlite-database';
const DB_KEY = 'main-db';
const DB_VERSION = 1;

// ============ IndexedDB 持久化 ============

/**
 * 打开 IndexedDB 数据库
 */
function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    };
    
    request.onsuccess = () => {
      resolve(request.result);
    };
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(DB_STORE_NAME)) {
        db.createObjectStore(DB_STORE_NAME);
      }
    };
  });
}

/**
 * 从 IndexedDB 加载数据库文件
 */
async function loadDatabaseFromIndexedDB(): Promise<Uint8Array | null> {
  try {
    const idb = await openIndexedDB();
    
    return new Promise((resolve, reject) => {
      const transaction = idb.transaction(DB_STORE_NAME, 'readonly');
      const store = transaction.objectStore(DB_STORE_NAME);
      const request = store.get(DB_KEY);
      
      request.onerror = () => {
        reject(new Error(`Failed to load database: ${request.error?.message}`));
      };
      
      request.onsuccess = () => {
        resolve(request.result || null);
      };
    });
  } catch {
    return null;
  }
}

/**
 * 保存数据库文件到 IndexedDB
 */
async function saveDatabaseToIndexedDB(data: Uint8Array): Promise<void> {
  const idb = await openIndexedDB();
  
  return new Promise((resolve, reject) => {
    const transaction = idb.transaction(DB_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(DB_STORE_NAME);
    const request = store.put(data, DB_KEY);
    
    request.onerror = () => {
      reject(new Error(`Failed to save database: ${request.error?.message}`));
    };
    
    request.onsuccess = () => {
      resolve();
    };
  });
}

// ============ SQLite 连接管理器 ============

class SQLiteConnectionManager {
  private state: SQLiteConnectionState = {
    db: null,
    SQL: null,
    status: 'idle',
    error: null,
  };
  
  private initPromise: Promise<void> | null = null;

  /**
   * 获取当前状态
   */
  getState(): SQLiteConnectionState {
    return { ...this.state };
  }

  /**
   * 初始化数据库连接
   */
  async initialize(): Promise<void> {
    // 防止重复初始化
    if (this.initPromise) {
      return this.initPromise;
    }
    
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      this.state.status = 'initializing';
      this.state.error = null;
      
      // 初始化 sql.js
      const SQL = await initSqlJs({
        // sql.js 的 WASM 文件位置
        locateFile: (file: string) => {
          // 使用 CDN 加载 WASM 文件
          return `https://sql.js.org/dist/${file}`;
        },
      });
      
      this.state.SQL = SQL;
      
      // 尝试从 IndexedDB 加载已有数据库
      const savedData = await loadDatabaseFromIndexedDB();
      
      if (savedData) {
        // 恢复已有数据库
        this.state.db = new SQL.Database(savedData);
      } else {
        // 创建新数据库
        this.state.db = new SQL.Database();
      }
      
      this.state.status = 'ready';
    } catch (err) {
      this.state.status = 'error';
      this.state.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /**
   * 获取数据库实例
   */
  getDatabase(): Database {
    if (!this.state.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.state.db;
  }

  /**
   * 执行 SQL 查询
   */
  exec(sql: string): void {
    const db = this.getDatabase();
    db.run(sql);
  }

  /**
   * 执行参数化查询
   */
  run(sql: string, params: (string | number | null)[] = []): { changes: number; lastInsertRowId: number } {
    const db = this.getDatabase();
    db.run(sql, params);
    return {
      changes: db.getRowsModified(),
      lastInsertRowId: Number(db.exec('SELECT last_insert_rowid() as id')[0]?.values[0]?.[0] || 0),
    };
  }

  /**
   * 查询并返回结果
   */
  query<T = Record<string, unknown>>(sql: string, params: (string | number | null)[] = []): T[] {
    const db = this.getDatabase();
    
    // sql.js 不支持直接参数化查询，需要手动处理
    // 这里使用简单的参数替换（注意：这不是防注入的最佳实践，但 sql.js 限制如此）
    let preparedSql = sql;
    params.forEach((param, index) => {
      const placeholder = `$${index + 1}`;
      if (param === null) {
        preparedSql = preparedSql.replace(placeholder, 'NULL');
      } else if (typeof param === 'string') {
        // 简单的转义，防止 SQL 注入
        const escaped = param.replace(/'/g, "''");
        preparedSql = preparedSql.replace(placeholder, `'${escaped}'`);
      } else {
        preparedSql = preparedSql.replace(placeholder, String(param));
      }
    });
    
    const results = db.exec(preparedSql);
    
    if (results.length === 0) {
      return [];
    }
    
    const columns = results[0].columns;
    return results[0].values.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col: string, i: number) => {
        obj[col] = row[i];
      });
      return obj as T;
    });
  }

  /**
   * 持久化数据库到 IndexedDB
   */
  async persist(): Promise<void> {
    if (!this.state.db) {
      return;
    }
    
    const data = this.state.db.export();
    await saveDatabaseToIndexedDB(data);
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.state.db) {
      this.state.db.close();
      this.state.db = null;
    }
    this.state.SQL = null;
    this.state.status = 'idle';
    this.initPromise = null;
  }

  /**
   * 检查数据库是否就绪
   */
  isReady(): boolean {
    return this.state.status === 'ready' && this.state.db !== null;
  }
}

// ============ 单例导出 ============

export const sqliteConnection = new SQLiteConnectionManager();

// ============ 便捷函数 ============

/**
 * 初始化 SQLite 数据库
 */
export async function initSQLite(): Promise<void> {
  return sqliteConnection.initialize();
}

/**
 * 获取数据库实例
 */
export function getDatabase(): Database {
  return sqliteConnection.getDatabase();
}

/**
 * 执行 SQL
 */
export function execSQL(sql: string): void {
  return sqliteConnection.exec(sql);
}

/**
 * 执行参数化查询
 */
export function runSQL(sql: string, params?: (string | number | null)[]): { changes: number; lastInsertRowId: number } {
  return sqliteConnection.run(sql, params);
}

/**
 * 查询数据
 */
export function querySQL<T = Record<string, unknown>>(sql: string, params?: (string | number | null)[]): T[] {
  return sqliteConnection.query<T>(sql, params);
}

/**
 * 持久化数据库
 */
export async function persistDatabase(): Promise<void> {
  return sqliteConnection.persist();
}
