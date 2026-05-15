const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint to serve the PDF manual
app.get('/', (req, res) => {
    const pdfPath = path.join(__dirname, 'docs', 'gear_manufacturing_manual.pdf');
    res.sendFile(pdfPath, (err) => {
        if (err) {
            res.status(404).send('PDF manual not found. Please place the file in /docs/gear_manufacturing_manual.pdf');
        }
    });
});

// All other routes go to index.html (single page app)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});