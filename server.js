const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve all static files (HTML, CSS, JS, images) from the "public" directory
app.use(express.static(path.join(__dirname, '')));

// For any other route (e.g., direct navigation to a subpath), serve index.html
// This enables client‑side routing (SPA behaviour)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});