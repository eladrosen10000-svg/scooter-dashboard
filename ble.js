// ble.js - Web Bluetooth communication for UniScooter / TUVALU controllers

const SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb";
const CHARACTERISTIC_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb";

let bluetoothDevice = null;
let gattServer = null;
let bleCharacteristic = null;

// Utility to log to the UI console
function log(msg) {
    const consoleEl = document.getElementById('debug-log');
    if (consoleEl) {
        consoleEl.value += `${new Date().toLocaleTimeString()} - ${msg}\n`;
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
    console.log(msg);
}

// 1. Device Request & Connection
async function connectBluetooth() {
    try {
        log("Requesting Bluetooth Device...");
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [{ services: [SERVICE_UUID] }],
            optionalServices: [SERVICE_UUID]
        });

        // 6. Add disconnection handlers
        bluetoothDevice.addEventListener('gattserverdisconnected', handleDisconnection);

        log(`Found device: ${bluetoothDevice.name || 'Unknown Scooter'}`);
        
        // 2. Connect GATT Server
        gattServer = await bluetoothDevice.gatt.connect();
        log("GATT Server connected");

        const service = await gattServer.getPrimaryService(SERVICE_UUID);
        bleCharacteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
        
        log("Characteristic found. Starting notifications...");
        
        // 5. Notification Parsing (Subscribe to telemetry)
        await bleCharacteristic.startNotifications();
        bleCharacteristic.addEventListener('characteristicvaluechanged', handleIncomingTelemetry);
        
        log("Successfully connected and listening!");
        
        // Dispatch custom event to notify UI
        document.dispatchEvent(new CustomEvent('scooter-connected'));
        
    } catch (error) {
        log(`Connection failed: ${error}`);
    }
}

function handleDisconnection(event) {
    log("Bluetooth Device disconnected");
    bluetoothDevice = null;
    gattServer = null;
    bleCharacteristic = null;
    
    // Dispatch custom event to notify UI
    document.dispatchEvent(new CustomEvent('scooter-disconnected'));
    
    // Check if auto-reconnect is enabled
    const autoReconnect = document.getElementById('toggle-auto-reconnect')?.checked;
    if (autoReconnect) {
        log("Auto-reconnect is enabled. Attempting to reconnect in 5 seconds...");
        setTimeout(() => {
            // Note: Web Bluetooth API usually requires a user gesture for requestDevice,
            // but if device is already known and paired, we might just try to reconnect gatt.
            // This is a simplified auto-reconnect logic.
            if (bluetoothDevice && bluetoothDevice.gatt) {
                bluetoothDevice.gatt.connect().catch(e => log(`Reconnect error: ${e}`));
            }
        }, 5000);
    }
}

// 5. Notification Parsing Logic
function handleIncomingTelemetry(event) {
    const value = event.target.value; // DataView
    // The exact parsing depends on the proprietary TUVALU protocol frame structure.
    // Assuming a standard frame where certain bytes represent speed, voltage, and ODO.
    // This is a mockup parser based on typical 16-byte frames.
    
    if (value.byteLength >= 10) {
        // Example parsing (byte indexes are hypothetical and must be tuned to the actual protocol)
        // Byte 4: Speed integer (km/h), Byte 5: Speed decimal
        const speedInt = value.getUint8(4);
        const speedDec = value.getUint8(5);
        const liveSpeed = parseFloat(`${speedInt}.${speedDec}`);
        
        // Byte 6 & 7: Voltage (divide by 10)
        const voltageRaw = value.getUint16(6, true); // true for little-endian, adjust if big-endian
        const voltage = voltageRaw / 10.0;
        
        // Byte 8, 9, 10, 11: ODO in meters or 100m units
        const odoRaw = value.getUint32(8, true);
        const odo = odoRaw / 10.0; // Assuming 100m units to km

        // Dispatch data to app.js
        document.dispatchEvent(new CustomEvent('scooter-telemetry', {
            detail: { speed: liveSpeed, voltage: voltage, odo: odo }
        }));
    }
}

// 3. Hex Sending Helper
async function sendHexCommand(byteArray) {
    if (!bleCharacteristic) {
        log("Cannot send command: Not connected");
        return;
    }
    try {
        const data = new Uint8Array(byteArray);
        await bleCharacteristic.writeValueWithoutResponse(data); // typical for ffe1 UART
        log(`Sent: [${byteArray.map(b => b.toString(16).padStart(2, '0')).join(' ')}]`);
    } catch (error) {
        log(`Send error: ${error}`);
    }
}

// 4. Commands API
// Note: The specific byte arrays below are placeholders for the UniScooter protocol.
// You will need to replace them with the exact hex frames for your controller.

const CMD_HEADER = [0x55, 0xAA]; // Typical frame header

function lockScooter() {
    log("Command: Lock Scooter");
    // Placeholder frame: Header, Length, Command ID, Action (0x01 Lock), Checksum
    sendHexCommand([...CMD_HEADER, 0x02, 0x10, 0x01, 0x68]); 
}

function unlockScooter() {
    log("Command: Unlock Scooter");
    sendHexCommand([...CMD_HEADER, 0x02, 0x10, 0x00, 0x67]); 
}

function setSpeedMode(modeName) {
    log(`Command: Set Mode to ${modeName}`);
    let modeByte = 0x00;
    switch(modeName) {
        case 'ECO': modeByte = 0x01; break;
        case 'DRV': modeByte = 0x02; break;
        case 'SPT': modeByte = 0x03; break;
        case 'PED': modeByte = 0x04; break; // Pedestrian
    }
    // Placeholder frame for changing gear
    sendHexCommand([...CMD_HEADER, 0x02, 0x11, modeByte, (0x13 + modeByte)]); 
}

function setPoliceMode(enabled) {
    log(`Command: Police Mode ${enabled ? 'ON' : 'OFF'}`);
    const actionByte = enabled ? 0x01 : 0x00;
    // Placeholder frame for speed limit toggle
    sendHexCommand([...CMD_HEADER, 0x02, 0x12, actionByte, (0x14 + actionByte)]); 
}

// Expose functions globally for app.js to use
window.scooterBLE = {
    connectBluetooth,
    lockScooter,
    unlockScooter,
    setSpeedMode,
    setPoliceMode
};