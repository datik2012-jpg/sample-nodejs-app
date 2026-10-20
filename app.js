const express = require('express');
const promClient = require('prom-client');

const app = express();
const port = process.env.PORT || 8080;

// Create a Registry to register the metrics - in memmory
const register = new promClient.Registry();

// Enable the collection of default metrics
promClient.collectDefaultMetrics({ register });

const helloWorldCounter = new promClient.Counter({
    name: 'root_access_total',
    help: 'Total number of accesses to /my-app',
    registers: [register],
});

const activeConnections = new promClient.Gauge({
    name: 'active_connections',
    help: 'Current number of active TCP connections',
    registers: [register],
});


const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});


// Define routes
app.get('/my-app', (req, res) => {
    helloWorldCounter.inc();
    res.send('Hello, World!');
});

app.get('/about', (req, res) => {
    res.send('This is a sample Node.js application for Kubernetes deployment testing.');
});

app.get('/ready', (req, res) => {
    res.status(200).send('Ready');
});

app.get('/live', (req, res) => {
    res.status(200).send('Alive');
});

app.get('/classified', (req, res) => {
    res.status(200).send('You should not be here!!!');
});



server.on('connection', (socket) => {
    activeConnections.inc(); 
    console.log('Opened connection to the app: +1');

    socket.once('close', () => {
        activeConnections.dec(); 
        console.log('Closed connection to the app: -1');
    });
});


app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});


