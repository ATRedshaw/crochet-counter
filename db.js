// db.js: IndexedDB wrapper module for storing and retrieving project data.

const DB_NAME = 'crochetCounterDB';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

// Holds the database connection instance.
let db;

/**
 * Initializes the IndexedDB database.
 * This function is idempotent; it will either open a new connection
 * or return the existing one.
 * @returns {Promise<IDBDatabase>} A promise that resolves with the database instance.
 */
async function initDB() {
    return new Promise((resolve, reject) => {
        // If connection exists, return it.
        if (db) {
            return resolve(db);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('Database error:', event.target.error);
            reject('Error opening database.');
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        // This event only runs if the database version changes.
        // It's used to set up the database schema.
        request.onupgradeneeded = (event) => {
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
                const objectStore = dbInstance.createObjectStore(STORE_NAME, { keyPath: 'id' });
                // Create an index to allow querying/sorting by lastModified timestamp.
                objectStore.createIndex('lastModified', 'lastModified', { unique: false });
            }
        };
    });
}

/**
 * Saves or updates a project in the database.
 * The 'put' method handles both creation and updates.
 * @param {object} projectObject - The project to save.
 * @returns {Promise<string>} The ID of the saved project.
 */
async function saveProject(projectObject) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(projectObject);

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject('Error saving project:', event.target.error);
    });
}

/**
 * Retrieves all projects, sorted by last modified date (newest first).
 * @returns {Promise<Array<object>>} A sorted array of project objects.
 */
async function getAllProjects() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('lastModified');
        // getAll() is more efficient than openCursor() for retrieving all records.
        const request = index.getAll();

        request.onsuccess = () => {
            // Sort descending (newest first) after retrieving.
            const sorted = request.result.sort((a, b) => b.lastModified - a.lastModified);
            resolve(sorted);
        };
        request.onerror = (event) => reject('Error fetching projects:', event.target.error);
    });
}

/**
 * Deletes a project by its ID.
 * @param {string} projectId - The ID of the project to delete.
 * @returns {Promise<void>} A promise that resolves when the deletion is complete.
 */
async function deleteProject(projectId) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(projectId);

        request.onsuccess = () => resolve();
        request.onerror = (event) => reject('Error deleting project:', event.target.error);
    });
}