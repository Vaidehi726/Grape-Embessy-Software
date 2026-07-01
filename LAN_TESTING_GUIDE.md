
# LAN Client Testing Guide

## Quick Start

### Your Network Info
- **Local IP**: 192.168.31.85
- **Server Port**: 3333
- **Server URL**: http://192.168.31.85:3333

---

## Test Scripts Created

### 1. `test-lan-api.ps1` - Automated API Test
Tests if the LAN server is running and accessible.

**Usage:**
```powershell
.\test-lan-api.ps1
```

**What it does:**
- ✓ Checks if server is running
- ✓ Tests /api/health endpoint
- ✓ Tests all data endpoints (tables, menu-items, etc.)
- ✓ Shows record counts
- ✓ Provides connection instructions

---

### 2. `test-lan-client.ps1` - Interactive Guide
Step-by-step interactive guide for manual testing.

**Usage:**
```powershell
.\test-lan-client.ps1
```

---

## How to Test LAN Client

### STEP 1: Start LAN Server (Main PC)

1. **Start the app:**
   ```powershell
   npm run dev:electron
   ```

2. **In the app:**
   - Go to **Settings → LAN Settings**
   - Select **"LAN Server"** mode
   - Note the IP shown (should be: `192.168.31.85`)

3. **Verify server is running:**
   ```powershell
   .\test-lan-api.ps1
   ```
   
   You should see:
   ```
   [SUCCESS] LAN Server is RUNNING
   ```

---

### STEP 2: Start LAN Client (Same or Different PC)

#### Option A: Same PC (Testing)
1. Open **another terminal window**
2. Run:
   ```powershell
   npm run dev:electron
   ```

#### Option B: Different PC (Real LAN Test)
1. On the second PC, make sure it's on the **same network**
2. Clone/pull the project
3. Install dependencies:
   ```powershell
   npm install
   ```
4. Run:
   ```powershell
   npm run dev:electron
   ```

---

### STEP 3: Connect as LAN Client

**In the client app:**

1. Go to **Settings → LAN Settings**
2. Select **"LAN Client"** mode
3. Enter:
   - **Server IP**: `192.168.31.85`
   - **Server Port**: `3333`
4. Click **"Connect"**

---

### STEP 4: Verify Connection

**On the LAN Client, check:**

- ✓ Can you see the dashboard?
- ✓ Can you view tables and floors?
- ✓ Can you see menu items?
- ✓ Can you create orders?
- ✓ Do orders appear on the server?
- ✓ Can you process payments?
- ✓ Can you view reports?

**Expected Behavior:**
- Client has **NO local database**
- All data reads from **Server's SQLite**
- All writes go to **Server's SQLite**
- **Real-time sync** between Server and Client

---

## Quick API Tests

Open browser on **Client PC** and visit:

```
http://192.168.31.85:3333/api/health
http://192.168.31.85:3333/api/tables
http://192.168.31.85:3333/api/menu-items
http://192.168.31.85:3333/api/floors
```

**Expected Response:**
```json
{
  "status": "ok",
  "message": "LAN Server running"
}
```

---

## Troubleshooting

### Connection Failed?

**1. Check Firewall**
Run as Administrator:
```powershell
netsh advfirewall firewall add rule name="TableFlow LAN" dir=in action=allow protocol=TCP localport=3333
```

**2. Ping the Server**
```powershell
ping 192.168.31.85
```

**3. Verify Same Network**
Both PCs must be on the same WiFi/LAN network.

**4. Check Server Console**
Look for errors in the server terminal.

**5. Test API Manually**
```powershell
.\test-lan-api.ps1
```

---

## Architecture

```
┌─────────────────┐         LAN          ┌─────────────────┐
│   LAN Server    │◄────────────────────►│   LAN Client    │
│   (Main PC)     │   HTTP API (3333)    │  (Second PC)    │
│                 │                      │                 │
│  ✓ SQLite DB    │                      │  ✗ No DB        │
│  ✓ Express API  │                      │  ✓ UI Only      │
│  ✓ Real-time    │                      │  ✓ Reads/Writes │
└─────────────────┘                      └─────────────────┘
```

**Key Points:**
- Client is **stateless** - no local storage
- All operations go through Server's API
- Server uses **SQLite** database
- **Real-time** synchronization
- Works on **same network** only

---

## Testing Checklist

### Server Side
- [ ] Server starts successfully
- [ ] API health check returns 200
- [ ] All endpoints accessible
- [ ] Data returns correctly
- [ ] Firewall port open (3001)

### Client Side
- [ ] Client connects to server
- [ ] Dashboard loads with server data
- [ ] Tables display correctly
- [ ] Menu items load
- [ ] Can create new orders
- [ ] Orders sync to server
- [ ] Payments process correctly
- [ ] Reports show server data

### Integration
- [ ] Real-time sync works
- [ ] Multiple clients can connect
- [ ] No data loss on disconnect
- [ ] Reconnection works after network issue

---

## Common Issues

### "Connection Refused"
- Server not started in LAN Server mode
- Wrong IP address
- Firewall blocking port 3333

### "No Data Loading"
- Client not connected properly
- Server has no data yet
- Network connectivity issue

### "Orders Not Syncing"
- Check server console for errors
- Verify client is in LAN Client mode
- Ensure stable network connection

---

## Next Steps

Once testing is successful:
1. Test with real restaurant data
2. Test with multiple clients
3. Test payment flow end-to-end
4. Test keyboard shortcuts on client
5. Test printing from client

---

**Need Help?**
Check the console logs in both server and client for detailed error messages.
