require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Iyzipay = require('iyzipay');

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

// Gelen JSON verilerini okuyabilmek için
app.use(express.json());

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

    // Site canlıdaysa canlı link, test ortamındaysa localhost linkine dönsün diye dinamikleştirildi.
    const origin = req.headers.origin || "https://palettedarikcisi.com";
    const callbackUrl = `${origin}/basarili`;

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
