/**
 * 向量数据库模块入口
 * 
 * 导出所有向量存储相关的功能
 */

// SQLite 连接管理
export {
  sqliteConnection,
  initSQLite,
  getDatabase,
  execSQL,
  runSQL,
  querySQL,
  persistDatabase,
  type ConnectionStatus,
  type SQLiteConnectionState,
} from './sqlite-connection';

// 数据库表结构
export {
  initializeSchema,
  tableExists,
  getAllTables,
  getTableSchema,
  clearAllData,
  dropAllTables,
  type EditRecord,
  type Document,
  type VectorRecord,
  type SchemaVersion,
} from './schema';

// 数据存储接口
export {
  writeEditRecord,
  writeEditRecords,
  writeDocument,
  updateDocument,
  writeVector,
  writeVectors,
  deleteVector,
  getEditRecordsByTimeRange,
  getEditRecordsByDocumentId,
  getEditRecordsByType,
  queryEditRecords,
  getEditRecordById,
  getDocumentById,
  getDocumentByFilename,
  getAllDocuments,
  getVectorById,
  getVectorsBySource,
  queryVectors,
  getAllVectors,
  getEditRecordStats,
  getVectorStats,
  generateId,
  type WriteEditRecordInput,
  type WriteDocumentInput,
  type WriteVectorInput,
  type QueryOptions,
  type EditRecordQueryOptions,
  type DocumentQueryOptions,
  type VectorQueryOptions,
} from './vector-store';

// 向量检索接口
export {
  fullTextSearch,
  searchEditRecords,
  cosineSimilarity,
  vectorSearch,
  batchVectorSearch,
  hybridSearch,
  getTopContent,
  searchBySourceId,
  clearSearchIndex,
  rebuildSearchIndex,
  type SearchResult,
  type HybridSearchResult,
  type SearchOptions,
  type VectorSearchOptions,
  type HybridSearchOptions,
} from './vector-search';
