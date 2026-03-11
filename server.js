const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite'); 

const app = express();

const diskPath = process.env.RENDER ? '/data' : __dirname;
// Okundu bilgisi
const dbPath = path.join(diskPath, 'takas_app_v10.db');
const db = new DatabaseSync(dbPath);

const uploadDir = path.join(diskPath, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.use(bodyParser.json());
app.use(express.static('public'));
app.use('/uploads', express.static(uploadDir));

// is_read 
db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user')`);
db.exec(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, description TEXT, size TEXT, city TEXT, img_url TEXT, type TEXT DEFAULT 'takas')`);
db.exec(`CREATE TABLE IF NOT EXISTS offers (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, sender_id INTEGER, receiver_id INTEGER, status TEXT DEFAULT 'pending')`);
db.exec(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER, content TEXT, is_read INTEGER DEFAULT 0, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);

// --- API UÇLARI ---

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    try {
        const row = db.prepare("SELECT count(*) as count FROM users").get();
        const role = row.count === 0 ? 'admin' : 'user';
        db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run(username, password, role);
        res.json({ ok: true });
    } catch (err) { res.status(400).send("Kullanıcı adı dolu"); }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ? AND password = ?").get(username, password);
    if (user) res.json(user); else res.status(401).send("Hatalı giriş");
});

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).send("Dosya yok");
    res.json({ filePath: `/uploads/${req.file.filename}` });
});

app.post('/api/products', (req, res) => {
    let { user_id, title, description, size, city, img_url, type } = req.body;
    if (!img_url || img_url.trim() === "") img_url = "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=500";
    db.prepare("INSERT INTO products (user_id, title, description, size, city, img_url, type) VALUES (?, ?, ?, ?, ?, ?, ?)").run(user_id, title, description, size, city, img_url, type);
    res.json({ ok: true });
});

app.get('/api/products', (req, res) => {
    const { search, city, size, type } = req.query;
    let query = "SELECT p.*, u.username FROM products p JOIN users u ON p.user_id = u.id WHERE 1=1";
    let params = [];
    if (search) { query += " AND (p.title LIKE ? OR p.description LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
    if (city) { query += " AND p.city = ?"; params.push(city); }
    if (size) { query += " AND p.size = ?"; params.push(size); }
    if (type) { query += " AND p.type = ?"; params.push(type); }
    query += " ORDER BY p.id DESC";
    res.json(db.prepare(query).all(...params));
});

app.delete('/api/products/:id', (req, res) => {
    const productId = req.params.id;
    const { user_id } = req.body;
    const product = db.prepare("SELECT user_id FROM products WHERE id = ?").get(productId);
    if (!product) return res.status(404).send("Ürün yok");
    const user = db.prepare("SELECT role FROM users WHERE id = ?").get(user_id);
    if (!user) return res.status(403).send("Kullanıcı yok");
    if (user.role === 'admin' || product.user_id === parseInt(user_id)) {
        db.prepare("DELETE FROM products WHERE id = ?").run(productId);
        res.json({ ok: true });
    } else {
        res.status(403).json({ error: "Yetkisiz işlem!" });
    }
});

app.post('/api/offers', (req, res) => {
    const { product_id, sender_id, receiver_id } = req.body;
    db.prepare("INSERT INTO offers (product_id, sender_id, receiver_id) VALUES (?, ?, ?)").run(product_id, sender_id, receiver_id);
    res.json({ ok: true });
});

app.get('/api/offers/:user_id', (req, res) => {
    const rows = db.prepare(`SELECT o.*, p.title as product_name, p.type as product_type, u.username as sender_name FROM offers o JOIN products p ON o.product_id = p.id JOIN users u ON o.sender_id = u.id WHERE o.receiver_id = ? ORDER BY o.id DESC`).all(req.params.user_id);
    res.json(rows || []);
});

// Gelen kutusu listesi
app.get('/api/conversations/:user_id', (req, res) => {
    const userId = req.params.user_id;
    const sql = `
        SELECT 
            u.id as contact_id, 
            u.username as contact_name,
            m.content as last_message,
            m.timestamp
        FROM users u
        JOIN messages m ON (u.id = m.sender_id OR u.id = m.receiver_id)
        WHERE (m.sender_id = ? OR m.receiver_id = ?) AND u.id != ?
        GROUP BY u.id
        ORDER BY m.timestamp DESC
    `;
    const rows = db.prepare(sql).all(userId, userId, userId);
    res.json(rows || []);
});

// Mesaj detaylarını getir ve okundu olarak işaretle
app.get('/api/messages/:u1/:u2', (req, res) => {
    const { u1, u2 } = req.params;
    
    // "okundu" 
    db.prepare("UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?").run(u2, u1);

    const rows = db.prepare(`SELECT * FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY timestamp ASC`).all(u1, u2, u2, u1);
    res.json(rows || []);
});

// Yeni mesaj gönder
app.post('/api/messages', (req, res) => {
    const { sender_id, receiver_id, content } = req.body;
    db.prepare("INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)").run(sender_id, receiver_id, content);
    res.json({ ok: true });
});

// YENİ: Okunmamış mesaj sayısını getir
app.get('/api/messages/unread/:user_id', (req, res) => {
    const row = db.prepare("SELECT count(*) as count FROM messages WHERE receiver_id = ? AND is_read = 0").get(req.params.user_id);
    res.json({ unread: row.count });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Sunucu aktif.`));
