// db.js: IndexedDB wrapper module.

const DB_NAME = 'crochetCounterDB';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

let db;

/**
 * Initializes the IndexedDB database.
 * Creates the object store if it doesn't exist.
 * @returns {Promise<IDBDatabase>}
 */
async function initDB() {
    return new Promise((resolve, reject) => {
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

        request.onupgradeneeded = (event) => {
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains(STORE_NAME)) {
                const objectStore = dbInstance.createObjectStore(STORE_NAME, { keyPath: 'id' });
                objectStore.createIndex('lastModified', 'lastModified', { unique: false });
            }
        };
    });
}

/**
 * Saves or updates a project in the database.
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
 * Retrieves all projects, sorted by last modified date.
 * @returns {Promise<Array<object>>} A sorted array of project objects.
 */
async function getAllProjects() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('lastModified');
        const request = index.getAll(); // Using index to allow sorting later

        request.onsuccess = () => {
            // Sort descending (newest first)
            const sorted = request.result.sort((a, b) => b.lastModified - a.lastModified);
            resolve(sorted);
        };
        request.onerror = (event) => reject('Error fetching projects:', event.target.error);
    });
}

/**
 * Deletes a project by its ID.
 * @param {string} projectId - The ID of the project to delete.
 * @returns {Promise<void>}
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