const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
const PORT = process.env.PORT || 3000;
// O Render gratuito não oferece disco persistente em /var/data.
let dbPath = process.env.DB_PATH || path.join(__dirname, 'cardapio.db');
try {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.accessSync(path.dirname(dbPath), fs.constants.W_OK);
} catch (_) {
  dbPath = path.join(__dirname, 'cardapio.db');
}
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL DEFAULT '', google_id TEXT, role TEXT NOT NULL DEFAULT 'customer', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '',
 ingredients TEXT DEFAULT '', category TEXT DEFAULT 'Lanches', price REAL NOT NULL DEFAULT 0,
 promo_price REAL, image TEXT DEFAULT '', badge TEXT DEFAULT '', available INTEGER DEFAULT 1,
 prep_time TEXT DEFAULT '20-35 min', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
 comment TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(product_id,user_id)
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), customer_name TEXT NOT NULL,
 phone TEXT DEFAULT '', fulfillment TEXT NOT NULL, address TEXT DEFAULT '', notes TEXT DEFAULT '',
 items_json TEXT NOT NULL, total REAL NOT NULL, status TEXT DEFAULT 'Pedido recebido',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS favorites (user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 product_id INTEGER REFERENCES products(id) ON DELETE CASCADE, PRIMARY KEY(user_id,product_id));
`);
// Migra bancos já existentes para aceitar login Google.
try { db.exec("ALTER TABLE users ADD COLUMN google_id TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE users ALTER COLUMN password_hash SET DEFAULT ''"); } catch (_) {}

// Limpa o catálogo antigo apenas uma vez para iniciar com a lista vazia solicitada.
if (!db.prepare("SELECT 1 FROM settings WHERE key='empty_catalog_initialized'").get()) {
 db.prepare('DELETE FROM products').run();
 db.prepare("INSERT INTO settings(key,value) VALUES('empty_catalog_initialized','1')").run();
}

// O catálogo começa vazio. Adicione os produtos pelo painel administrativo quando estiver pronto.
const seedAdminEmail = process.env.ADMIN_EMAIL;
const seedAdminPassword = process.env.ADMIN_PASSWORD;
if (seedAdminEmail && seedAdminPassword && !db.prepare('SELECT id FROM users WHERE email=?').get(seedAdminEmail.toLowerCase())) {
 db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)')
   .run('Administrador',seedAdminEmail.toLowerCase(),bcrypt.hashSync(seedAdminPassword,12),'admin');
}

const ownerEmail = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();
app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true}));
app.use(session({
 secret: process.env.SESSION_SECRET || 'troque-esta-chave-antes-de-publicar-8f3a2d',
 resave:false, saveUninitialized:false,
 cookie:{ httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV==='production', maxAge:7*24*60*60*1000 }
}));
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => { try { done(null, db.prepare('SELECT * FROM users WHERE id=?').get(id)); } catch (e) { done(e); } });
const googleCallbackURL = process.env.GOOGLE_CALLBACK_URL || '';
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && googleCallbackURL) {
 passport.use(new GoogleStrategy({ clientID: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, callbackURL: googleCallbackURL }, (accessToken, refreshToken, profile, done) => {
  try { const email = String(profile.emails?.[0]?.value || '').toLowerCase(); if (!email) return done(new Error('A conta Google não forneceu e-mail.'));
   let u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
   const role = ownerEmail && email === ownerEmail ? 'owner' : (u?.role || 'customer');
   if (!u) { const info = db.prepare('INSERT INTO users(name,email,password_hash,google_id,role) VALUES(?,?,?,?,?)').run(profile.displayName || email.split('@')[0], email, '', profile.id, role); u = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid); }
   else { db.prepare('UPDATE users SET google_id=?, role=? WHERE id=?').run(profile.id, role, u.id); u = db.prepare('SELECT * FROM users WHERE id=?').get(u.id); }
   return done(null, u);
  } catch (e) { return done(e); }
 }));
}
let uploadDir = process.env.UPLOAD_DIR || path.join(__dirname,'uploads');
try {
 fs.mkdirSync(uploadDir,{recursive:true});
 fs.accessSync(uploadDir,fs.constants.W_OK);
} catch (_) {
 uploadDir = path.join(__dirname,'uploads');
 fs.mkdirSync(uploadDir,{recursive:true});
}
const storage=multer.diskStorage({destination:(_,__,cb)=>cb(null,uploadDir),filename:(_,file,cb)=>cb(null,Date.now()+'-'+file.originalname.replace(/[^a-zA-Z0-9._-]/g,'_'))});
const upload=multer({storage,limits:{fileSize:5*1024*1024},fileFilter:(_,f,cb)=>cb(null,/^image\/(jpeg|png|webp|gif)$/.test(f.mimetype))});
app.use('/uploads',express.static(uploadDir));
app.use(express.static(path.join(__dirname,'public')));

const publicUser = u => u ? ({id:u.id,name:u.name,email:u.email,role:u.role}) : null;
const currentUser = req => { if(!req.session.user) return null; const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id); if(u && ownerEmail && u.email.toLowerCase()===ownerEmail && u.role!=='owner'){db.prepare("UPDATE users SET role='owner' WHERE id=?").run(u.id);u.role='owner';} return u; };
const requireAuth=(req,res,next)=>{const u=currentUser(req);if(!u)return res.status(401).json({error:'Entre na sua conta para continuar.'});req.user=u;next();};
const requireAdmin=(req,res,next)=>{const u=currentUser(req);if(!u||!['admin','owner'].includes(u.role))return res.status(403).json({error:'Acesso exclusivo do administrador.'});req.user=u;next();};
function productRow(p) {
 const r=db.prepare('SELECT ROUND(AVG(stars),1) rating, COUNT(*) review_count FROM reviews WHERE product_id=?').get(p.id);
 return {...p,available:!!p.available,rating:r.rating||0,review_count:r.review_count};
}
app.get('/auth/google',(req,res,next)=>{ if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !googleCallbackURL) return res.status(503).send('Login Google ainda não configurado. Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_CALLBACK_URL no Render.'); passport.authenticate('google',{scope:['profile','email'], prompt:'select_account'})(req,res,next); });
app.get('/auth/google/callback',(req,res,next)=>passport.authenticate('google',{failureRedirect:'/?google=error'},(err,u)=>{ if(err || !u) return res.redirect('/?google=error'); req.session.regenerate(sessionErr=>{ if(sessionErr) return res.redirect('/?google=error'); req.session.user={id:u.id}; res.redirect(u.role==='owner'||u.role==='admin'?'/admin':'/?login=success'); }); })(req,res,next));
app.get('/api/session',(req,res)=>res.json({user:publicUser(currentUser(req))}));
app.post('/api/register',async(req,res)=>{
 const name=String(req.body.name||'').trim(),email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');
 if(name.length<2||!email.includes('@')||password.length<8)return res.status(400).json({error:'Informe nome, e-mail válido e senha com pelo menos 8 caracteres.'});
 try {const info=db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name,email,await bcrypt.hash(password,12));
 const user=db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);req.session.user={id:user.id};res.json({user:publicUser(user)});}
 catch(e){res.status(409).json({error:'Este e-mail já está cadastrado.'});}
});
app.post('/api/login',async(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');
 const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);
 if(!u||!u.password_hash||!await bcrypt.compare(password,u.password_hash))return res.status(401).json({error:'E-mail ou senha incorretos. Se usa Google, entre pelo botão Google.'});
 req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Não foi possível iniciar a sessão.'});req.session.user={id:u.id};res.json({user:publicUser(u)});});
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/products',(req,res)=>{
 const {q='',category=''}=req.query;let sql='SELECT * FROM products WHERE 1=1',args=[];
 if(q){sql+=' AND (name LIKE ? OR description LIKE ? OR ingredients LIKE ?)';args.push(`%${q}%`,`%${q}%`,`%${q}%`);}
 if(category){sql+=' AND category=?';args.push(category);}
 sql+=' ORDER BY id DESC';res.json(db.prepare(sql).all(...args).map(productRow));
});
app.get('/api/categories',(req,res)=>res.json(db.prepare('SELECT DISTINCT category FROM products ORDER BY category').all().map(x=>x.category)));
app.get('/api/products/:id/reviews',(req,res)=>{
 res.json(db.prepare(`SELECT r.id,r.stars,r.comment,r.created_at,u.name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? ORDER BY r.created_at DESC`).all(req.params.id));
});
app.post('/api/products/:id/reviews',requireAuth,(req,res)=>{
 const id=Number(req.params.id),stars=Number(req.body.stars),comment=String(req.body.comment||'').trim().slice(0,1000);
 if(!db.prepare('SELECT id FROM products WHERE id=?').get(id))return res.status(404).json({error:'Produto não encontrado.'});
 if(!Number.isInteger(stars)||stars<1||stars>5)return res.status(400).json({error:'Escolha de 1 a 5 estrelas.'});
 try{db.prepare('INSERT INTO reviews(product_id,user_id,stars,comment) VALUES(?,?,?,?)').run(id,req.user.id,stars,comment);res.json({ok:true});}
 catch(e){res.status(409).json({error:'Você já avaliou este produto.'});}
});
app.get('/api/favorites',requireAuth,(req,res)=>res.json(db.prepare('SELECT product_id FROM favorites WHERE user_id=?').all(req.user.id).map(x=>x.product_id)));
app.post('/api/favorites/:id',requireAuth,(req,res)=>{
 const id=Number(req.params.id);if(!db.prepare('SELECT id FROM products WHERE id=?').get(id))return res.status(404).json({error:'Produto não encontrado.'});
 const found=db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND product_id=?').get(req.user.id,id);
 if(found)db.prepare('DELETE FROM favorites WHERE user_id=? AND product_id=?').run(req.user.id,id);else db.prepare('INSERT INTO favorites(user_id,product_id) VALUES(?,?)').run(req.user.id,id);
 res.json({favorite:!found});
});
app.post('/api/orders',requireAuth,(req,res)=>{
 const {items,customer_name,phone,fulfillment,address,notes}=req.body;
 if(!Array.isArray(items)||!items.length)return res.status(400).json({error:'Seu carrinho está vazio.'});
 if(!['Entrega','Retirada'].includes(fulfillment))return res.status(400).json({error:'Escolha entrega ou retirada.'});
 if(fulfillment==='Entrega'&&!String(address||'').trim())return res.status(400).json({error:'Informe o endereço de entrega.'});
 const normalized=[];let total=0;
 for(const item of items){const p=db.prepare('SELECT * FROM products WHERE id=? AND available=1').get(Number(item.id));const qty=Math.max(1,Math.min(50,parseInt(item.qty)||1));if(!p)continue;const price=p.promo_price??p.price;normalized.push({id:p.id,name:p.name,price,qty});total+=price*qty;}
 if(!normalized.length)return res.status(400).json({error:'Nenhum produto disponível no carrinho.'});
 const info=db.prepare('INSERT INTO orders(user_id,customer_name,phone,fulfillment,address,notes,items_json,total) VALUES(?,?,?,?,?,?,?,?)')
 .run(req.user.id,String(customer_name||req.user.name).slice(0,100),String(phone||'').slice(0,30),fulfillment,String(address||'').slice(0,500),String(notes||'').slice(0,1000),JSON.stringify(normalized),Math.round(total*100)/100);
 res.json({id:info.lastInsertRowid,total});
});
app.get('/api/my-orders',requireAuth,(req,res)=>res.json(db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC').all(req.user.id).map(o=>({...o,items:JSON.parse(o.items_json)}))));
app.get('/api/admin/stats',requireAdmin,(req,res)=>res.json({
 products:db.prepare('SELECT COUNT(*) n FROM products').get().n,
 customers:db.prepare("SELECT COUNT(*) n FROM users WHERE role='customer'").get().n,
 orders:db.prepare('SELECT COUNT(*) n FROM orders').get().n,
 pending:db.prepare("SELECT COUNT(*) n FROM orders WHERE status='Pedido recebido'").get().n,
 completed:db.prepare("SELECT COUNT(*) n FROM orders WHERE status='Finalizado'").get().n,
 revenue:db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status!='Cancelado'").get().n,
 rating:db.prepare('SELECT ROUND(AVG(stars),1) n FROM reviews').get().n||0
}));
app.get('/api/admin/orders',requireAdmin,(req,res)=>res.json(db.prepare('SELECT * FROM orders ORDER BY id DESC').all().map(o=>({...o,items:JSON.parse(o.items_json)}))));
app.patch('/api/admin/orders/:id',requireAdmin,(req,res)=>{
 const allowed=['Pedido recebido','Em preparação','Saiu para entrega','Finalizado','Cancelado'];
 if(!allowed.includes(req.body.status))return res.status(400).json({error:'Status inválido.'});
 const info=db.prepare('UPDATE orders SET status=? WHERE id=?').run(req.body.status,req.params.id);
 res.json({ok:!!info.changes});
});
app.get('/api/admin/products',requireAdmin,(req,res)=>res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all().map(productRow)));
app.post('/api/admin/products',requireAdmin,upload.single('imageFile'),(req,res)=>{
 const b=req.body;const name=String(b.name||'').trim(),price=Number(b.price);
 if(!name||!Number.isFinite(price)||price<0)return res.status(400).json({error:'Informe nome e preço válido.'});
 const image=req.file?'/uploads/'+req.file.filename:String(b.image||'');
 const promo=b.promo_price===''||b.promo_price==null?null:Number(b.promo_price);
 const info=db.prepare('INSERT INTO products(name,description,ingredients,category,price,promo_price,image,badge,available,prep_time) VALUES(?,?,?,?,?,?,?,?,?,?)')
 .run(name,String(b.description||''),String(b.ingredients||''),String(b.category||'Lanches'),price,Number.isFinite(promo)?promo:null,image,String(b.badge||''),b.available==='false'?0:1,String(b.prep_time||'20-35 min'));
 res.json(productRow(db.prepare('SELECT * FROM products WHERE id=?').get(info.lastInsertRowid)));
});
app.put('/api/admin/products/:id',requireAdmin,upload.single('imageFile'),(req,res)=>{
 const b=req.body,old=db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);if(!old)return res.status(404).json({error:'Produto não encontrado.'});
 const price=Number(b.price);if(!String(b.name||'').trim()||!Number.isFinite(price)||price<0)return res.status(400).json({error:'Nome e preço válido são obrigatórios.'});
 const promo=b.promo_price===''||b.promo_price==null?null:Number(b.promo_price);
 const image=req.file?'/uploads/'+req.file.filename:String(b.image||old.image);
 db.prepare('UPDATE products SET name=?,description=?,ingredients=?,category=?,price=?,promo_price=?,image=?,badge=?,available=?,prep_time=? WHERE id=?')
 .run(String(b.name),String(b.description||''),String(b.ingredients||''),String(b.category||'Lanches'),price,Number.isFinite(promo)?promo:null,image,String(b.badge||''),b.available==='false'?0:1,String(b.prep_time||'20-35 min'),req.params.id);
 res.json(productRow(db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id)));
});
app.delete('/api/admin/products/:id',requireAdmin,(req,res)=>{db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/admin/reviews',requireAdmin,(req,res)=>res.json(db.prepare('SELECT r.*,u.name user_name,p.name product_name FROM reviews r JOIN users u ON u.id=r.user_id JOIN products p ON p.id=r.product_id ORDER BY r.id DESC').all()));
app.delete('/api/admin/reviews/:id',requireAdmin,(req,res)=>{db.prepare('DELETE FROM reviews WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('/api/admin/users',requireAdmin,(req,res)=>res.json(db.prepare("SELECT id,name,email,role,created_at FROM users ORDER BY id DESC").all()));
const requireOwner=(req,res,next)=>{const u=currentUser(req);if(!u||u.role!=='owner'||!ownerEmail||u.email.toLowerCase()!==ownerEmail)return res.status(403).json({error:'Somente o dono pode gerenciar administradores.'});req.user=u;next();};
app.patch('/api/owner/users/:id/role',requireOwner,(req,res)=>{const role=String(req.body.role||'');if(!['customer','admin'].includes(role))return res.status(400).json({error:'Perfil inválido.'});const target=db.prepare('SELECT id,email,role FROM users WHERE id=?').get(req.params.id);if(!target)return res.status(404).json({error:'Conta não encontrada.'});if(target.email.toLowerCase()===ownerEmail)return res.status(400).json({error:'A conta do dono não pode ser alterada.'});db.prepare('UPDATE users SET role=? WHERE id=?').run(role,target.id);res.json({ok:true});});
app.get('/api/admin/settings',requireAdmin,(req,res)=>res.json(Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value]))));
app.put('/api/admin/settings',requireAdmin,(req,res)=>{
 const allowed=['store_name','description','phone','address','hours','primary_color','logo_burguer','logo_doces'];
 const stmt=db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
 for(const k of allowed)if(req.body[k]!==undefined)stmt.run(k,String(req.body[k]).slice(0,1000));
 res.json({ok:true});
});
app.get('/api/settings',(req,res)=>res.json(Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value]))));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Cardápio Digital rodando na porta ${PORT}`));
