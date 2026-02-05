const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
// Veritabanı dosyasını proje klasörüne sabitliyoruz (Silinmemesi için)
const dbPath = path.join(__dirname, 'takas_app_final.db');
const db = new sqlite3.Database(dbPath);

// Upload klasörü kontrolü
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Resim Yükleme Ayarları
const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.use(bodyParser.json());
app.use(express.static('public'));

// Veritabanı Tabloları
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user')`);
    db.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, size TEXT, img_url TEXT, type TEXT DEFAULT 'takas')`);
    db.run(`CREATE TABLE IF NOT EXISTS offers (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, sender_id INTEGER, receiver_id INTEGER, status TEXT DEFAULT 'pending')`);
});

// --- API UÇLARI ---

// Kayıt Ol (İlk kullanıcı Admin olur)
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT count(*) as count FROM users", (err, row) => {
        const role = row.count === 0 ? 'admin' : 'user';
        db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", [username, password, role], (err) => {
            if (err) res.status(400).send("Kullanıcı adı dolu"); else res.json({ ok: true });
        });
    });
});

// Giriş Yap
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, user) => {
        if (user) res.json(user); else res.status(401).send("Hatalı giriş");
    });
});

// Resim Yükle
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).send("Dosya yok");
    res.json({ filePath: `/uploads/${req.file.filename}` });
});

// Ürün Ekle (Default resim destekli)
app.post('/api/products', (req, res) => {
    let { user_id, title, size, img_url, type } = req.body;
    if (!img_url || img_url.trim() === "") img_url = "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=500"; // Default kıyafet resmi
    
    db.run("INSERT INTO products (user_id, title, size, img_url, type) VALUES (?, ?, ?, ?, ?)", 
    [user_id, title, size, img_url, type], () => res.json({ ok: true }));
});

// Ürünleri Getir
app.get('/api/products', (req, res) => {
    db.all("SELECT p.*, u.username FROM products p JOIN users u ON p.user_id = u.id ORDER BY p.id DESC", (err, rows) => res.json(rows || []));
});

// Ürün Sil (GÜVENLİK KONTROLLÜ)
app.delete('/api/products/:id', (req, res) => {
    const productId = req.params.id;
    const { user_id } = req.body; // Silme isteğini gönderen kişi

    // 1. Ürünü bul
    db.get("SELECT user_id FROM products WHERE id = ?", [productId], (err, product) => {
        if (!product) return res.status(404).send("Ürün yok");

        // 2. Kullanıcıyı bul (Admin mi diye bakmak için)
        db.get("SELECT role FROM users WHERE id = ?", [user_id], (err, user) => {
            if (!user) return res.status(403).send("Kullanıcı yok");

            // 3. KONTROL: Kullanıcı admin mi VEYA ürünün sahibi mi?
            if (user.role === 'admin' || product.user_id === parseInt(user_id)) {
                db.run("DELETE FROM products WHERE id = ?", [productId], () => res.json({ ok: true }));
            } else {
                res.status(403).json({ error: "Yetkisiz işlem!" });
            }
        });
    });
});

// Takas/Bağış İsteği Gönder
app.post('/api/offers', (req, res) => {
    const { product_id, sender_id, receiver_id } = req.body;
    db.run("INSERT INTO offers (product_id, sender_id, receiver_id) VALUES (?, ?, ?)", [product_id, sender_id, receiver_id], () => res.json({ ok: true }));
});

// Gelen Kutusu
app.get('/api/offers/:user_id', (req, res) => {
    const sql = `SELECT o.*, p.title as product_name, p.type as product_type, u.username as sender_name FROM offers o 
                 JOIN products p ON o.product_id = p.id 
                 JOIN users u ON o.sender_id = u.id 
                 WHERE o.receiver_id = ? ORDER BY o.id DESC`;
    db.all(sql, [req.params.user_id], (err, rows) => res.json(rows || []));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sunucu çalışıyor: http://localhost:${PORT}`));