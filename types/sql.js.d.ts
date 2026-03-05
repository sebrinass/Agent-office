/**
 * sql.js 类型声明
 * 
 * 由于 @types/sql.js 可能不可用，提供本地类型声明
 */

declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  export interface Database {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string): QueryExecResult[];
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
