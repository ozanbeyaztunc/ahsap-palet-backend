require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Iyzipay = require('iyzipay');
const nodemailer = require('nodemailer');

const app = express();

// Sadece senin sitenden gelen isteklere izin ver (Güvenlik)
// Geliştirme ortamı (Vite vb.) için localhost portlarını (3000, 5173 vs.) ekledim.
app.use(cors({
    origin: [
        'http://localhost:3000', 
        'http://localhost:5173', 
        'https://palettedarikcisi.com', 
        'https://www.palettedarikcisi.com'
    ]
}));

// Gelen POST/JSON verilerini okuyabilmek için
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Iyzico Ayarları
const iyzipay = new Iyzipay({
    apiKey: process.env.IYZICO_API_KEY,
    secretKey: process.env.IYZICO_SECRET_KEY,
    uri: process.env.IYZICO_URI
});

// --- API DURUM KONTROLÜ (TEST İÇİN) ---
app.get('/api', (req, res) => {
    res.json({ message: "Palet Tedarikçisi Backend ayakta ve çalışıyor!" });
});

// --- ÖDEME LİNKİ ÜRETME ENDPOINT'İ ---
app.post('/api/payment', (req, res) => {
    const { urunAdi, adet, toplamTutar } = req.body;

    // Gerekli bilgilerin geldiğinden emin olalım
    if (!urunAdi || !toplamTutar) {
        return res.status(400).json({ error: "Lütfen ürün adı ve toplam tutar bilgilerini gönderin." });
    }

    // Iyzico bu urlye POST atacak. Dönüş adresi kendi backendimiz olmalı.
    const callbackUrl = (process.env.BACKEND_URL || "https://ahsap-palet-backend-saod.onrender.com") + "/api/payment/callback";

    const request = {
        locale: Iyzipay.LOCALE.TR,
        conversationId: Math.random().toString(36).substring(7), // Rastgele sipariş no
        price: toplamTutar.toString(),
        paidPrice: toplamTutar.toString(),
        currency: Iyzipay.CURRENCY.TRY,
        basketId: "B" + Math.floor(Math.random() * 10000),
        paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
        callbackUrl: callbackUrl, // Ödeme bitince döneceği link (Dinamik yapıldı)
        enabledInstallments: [2, 3, 6, 9],
        buyer: {
            id: "BY789",
            name: "Müşteri",
            surname: "Kayıtsız",
            gsmNumber: "+905555555555",
            email: "email@email.com",
            identityNumber: "11111111111",
            lastLoginDate: "2023-01-01 12:00:00",
            registrationDate: "2023-01-01 12:00:00",
            registrationAddress: "N/A",
            ip: req.ip || "85.34.78.112",
            city: "Istanbul",
            country: "Turkey",
            zipCode: "34732"
        },
        shippingAddress: {
            contactName: "Müşteri",
            city: "Istanbul",
            country: "Turkey",
            address: "N/A",
            zipCode: "34732"
        },
        billingAddress: {
            contactName: "Müşteri",
            city: "Istanbul",
            country: "Turkey",
            address: "N/A",
            zipCode: "34732"
        },
        basketItems: [
            {
                id: "PLT-" + Math.floor(Math.random() * 1000),
                name: urunAdi,
                category1: "Palet",
                itemType: Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
                price: toplamTutar.toString()
            }
        ]
    };

    // Iyzico'ya İsteği Atıyoruz
    iyzipay.checkoutFormInitialize.create(request, function (err, result) {
        if (err || result.status === 'failure') {
            console.error("Iyzico Hatası:", result?.errorMessage || err);
            return res.status(500).json({ error: "Ödeme linki oluşturulamadı.", details: result?.errorMessage || err });
        }
        
        // Iyzico başarılı dönerse, paymentPageUrl'i frontend'e yolla
        res.status(200).json({ 
            paymentUrl: result.paymentPageUrl + "&token=" + result.token 
        });
    });
});

// --- İYZİCO ÖDEME SONUCU (CALLBACK) ENDPOINT'İ ---
app.post('/api/payment/callback', (req, res) => {
    const token = req.body.token;
    const frontendUrl = process.env.FRONTEND_URL || "https://palettedarikcisi.com";

    if (!token) {
        return res.redirect(frontendUrl + "/basarisiz");
    }

    // Token ile İyziCo'dan sipariş sonucunu alıyoruz
    iyzipay.checkoutForm.retrieve({
        locale: Iyzipay.LOCALE.TR,
        token: token
    }, function (err, result) {
        if (err || result.status === 'failure' || result.paymentStatus !== 'SUCCESS') {
            console.error("Ödeme onaylanmadı veya hata oluştu:", result?.errorMessage || err);
            return res.redirect(frontendUrl + "/basarisiz");
        }

        // --- ÖDEME BAŞARILI: E-POSTA BİLDİRİMİ GÖNDER ---
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "mail.palettedarikcisi.com",
            port: process.env.SMTP_PORT || 465,
            secure: process.env.SMTP_SECURE !== 'false', // 465 ise true
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        // İyziCo'dan gelen sepet içeriğini (itemTransactions) okutalım
        let urunler = "Bilinmiyor";
        if (result.itemTransactions && result.itemTransactions.length > 0) {
            urunler = result.itemTransactions.map(item => `${item.name} (${item.paidPrice} TL)`).join('\n- ');
        }

        const mailOptions = {
            from: process.env.EMAIL_USER, // Gönderen aynı mail olmalı (kimlik doğrulama için)
            to: process.env.EMAIL_USER,   // Alıcı da siz (bildirim)
            subject: '📦 YENİ SİPARİŞ GELDİ! (Palet Tedarikçisi)',
            text: `Web sitenizden yeni bir sipariş ve başarılı ödeme aldınız!\n\n` +
                  `MÜŞTERİ BİLGİLERİ:\n` +
                  `-------------------\n` +
                  `Ad Soyad: ${result.buyer?.name} ${result.buyer?.surname}\n` +
                  `Telefon: ${result.buyer?.gsmNumber}\n` +
                  `E-Posta: ${result.buyer?.email}\n` +
                  `Teslimat Adresi: ${result.shippingAddress?.address}, ${result.shippingAddress?.city} - ${result.shippingAddress?.zipCode}\n\n` +
                  `SİPARİŞ DETAYI:\n` +
                  `-------------------\n` +
                  `Sipariş Numarası (Iyzico): ${result.paymentId || result.conversationId}\n` +
                  `Toplam Ödenen: ${result.paidPrice} TL\n\n` +
                  `ALINAN ÜRÜNLER:\n` +
                  `- ${urunler}`
        };

        transporter.sendMail(mailOptions, (mailErr, info) => {
            if (mailErr) {
                console.error("Mail gönderilemedi, ayarlar hatalı olabilir:", mailErr);
            } else {
                console.log("Sipariş bildirim e-postası başarıyla gönderildi: " + info.response);
            }
        });

        // İşlem tamam: Müşteriyi sitenin sipariş başarılı sayfasına yönlendir (redirect).
        res.redirect(frontendUrl + "/basarili");
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
