# Electron Desktop Integration

<cite>
**Referenced Files in This Document**
- [package.json](file://package.json)
- [vite.config.ts](file://vite.config.ts)
- [electron/main.ts](file://electron/main.ts)
- [electron/preload.ts](file://electron/preload.ts)
- [electron/services/nativePrinter.ts](file://electron/services/nativePrinter.ts)
- [electron/services/localDb.ts](file://electron/services/localDb.ts)
- [electron/services/syncEngine.ts](file://electron/services/syncEngine.ts)
- [electron/services/lanClient.ts](file://electron/services/lanClient.ts)
- [electron/services/sqliteLanServer.ts](file://electron/services/sqliteLanServer.ts)
- [src/services/thermalPrinter.ts](file://src/services/thermalPrinter.ts)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Security Considerations](#security-considerations)
9. [Build and Packaging](#build-and-packaging)
10. [Troubleshooting Guide](#troubleshooting-guide)
11. [Conclusion](#conclusion)

## Introduction
This document explains the Electron desktop integration architecture for the project. It covers the main process structure, preload bridge, inter-process communication (IPC) patterns, offline-first database design, LAN synchronization, native printer integration, and desktop packaging. It also highlights security hardening and platform-specific deployment considerations for Windows deployments.

## Project Structure
The desktop integration is implemented under the electron/ directory with supporting services and a preload bridge. The Vite configuration wires Electron builds and renders the React frontend. The package.json defines scripts, native module rebuild hooks, and electron-builder configuration for packaging.

```mermaid
graph TB
subgraph "Electron Build"
Vite["Vite Config<br/>vite.config.ts"]
MainTS["Main Process<br/>electron/main.ts"]
PreloadTS["Preload Bridge<br/>electron/preload.ts"]
end
subgraph "Services"
Printer["Native Printer Service<br/>electron/services/nativePrinter.ts"]
LocalDB["Local SQLite DB<br/>electron/services/localDb.ts"]
SyncEng["Sync Engine<br/>electron/services/syncEngine.ts"]
LanClient["LAN Client<br/>electron/services/lanClient.ts"]
LanServer["LAN SQLite Server<br/>electron/services/sqliteLanServer.ts"]
end
subgraph "Renderer"
ReactUI["React UI<br/>src/pages/*, src/components/*"]
ThermalWeb["Web Thermal Printer<br/>src/services/thermalPrinter.ts"]
end
Vite --> MainTS
Vite --> PreloadTS
MainTS --> Printer
MainTS --> LocalDB
MainTS --> SyncEng
MainTS --> LanClient
MainTS --> LanServer
PreloadTS --> ReactUI
ReactUI --> ThermalWeb
```

**Diagram sources**
- [vite.config.ts:1-69](file://vite.config.ts#L1-L69)
- [electron/main.ts:1-450](file://electron/main.ts#L1-L450)
- [electron/preload.ts:1-90](file://electron/preload.ts#L1-L90)
- [electron/services/nativePrinter.ts:1-542](file://electron/services/nativePrinter.ts#L1-L542)
- [electron/services/localDb.ts:1-401](file://electron/services/localDb.ts#L1-L401)
- [electron/services/syncEngine.ts:1-124](file://electron/services/syncEngine.ts#L1-L124)
- [electron/services/lanClient.ts:1-364](file://electron/services/lanClient.ts#L1-L364)
- [electron/services/sqliteLanServer.ts:1-520](file://electron/services/sqliteLanServer.ts#L1-L520)
- [src/services/thermalPrinter.ts:1-339](file://src/services/thermalPrinter.ts#L1-L339)

**Section sources**
- [vite.config.ts:1-69](file://vite.config.ts#L1-L69)
- [package.json:1-131](file://package.json#L1-L131)

## Core Components
- Main process: Creates the BrowserWindow, registers IPC handlers for printer, database, sync, and LAN operations, and manages lifecycle events.
- Preload bridge: Exposes a typed API surface to the renderer via contextBridge, forwarding invocations to the main process.
- Native printer service: USB and Windows raw-port printing with fallbacks and Windows printer selection.
- Local database: Offline-first SQLite with sync tracking and indexes for key tables.
- Sync engine: One-time pull from Supabase into local SQLite; push is manual-triggered from the renderer.
- LAN client/server: HTTP + WebSocket server/client for multi-device synchronization and kitchen order streaming.

**Section sources**
- [electron/main.ts:1-450](file://electron/main.ts#L1-L450)
- [electron/preload.ts:1-90](file://electron/preload.ts#L1-L90)
- [electron/services/nativePrinter.ts:1-542](file://electron/services/nativePrinter.ts#L1-L542)
- [electron/services/localDb.ts:1-401](file://electron/services/localDb.ts#L1-L401)
- [electron/services/syncEngine.ts:1-124](file://electron/services/syncEngine.ts#L1-L124)
- [electron/services/lanClient.ts:1-364](file://electron/services/lanClient.ts#L1-L364)
- [electron/services/sqliteLanServer.ts:1-520](file://electron/services/sqliteLanServer.ts#L1-L520)

## Architecture Overview
The desktop app runs a single BrowserWindow with contextIsolation enabled and a preload bridge. Renderer code invokes electronAPI methods, which use ipcRenderer.invoke/listener to communicate with the main process. The main process delegates to service modules for printer control, local storage, synchronization, and LAN networking.

```mermaid
sequenceDiagram
participant UI as "Renderer UI"
participant Bridge as "Preload Bridge"
participant Main as "Main Process"
participant DB as "LocalDatabase"
participant Sync as "SyncEngine"
participant LANC as "LanClient"
participant LANS as "SqliteLanServer"
UI->>Bridge : electronAPI.db.query(table, filters)
Bridge->>Main : ipcRenderer.invoke("db : query", table, filters)
Main->>DB : query(table, filters)
DB-->>Main : rows[]
Main-->>Bridge : {success, data}
Bridge-->>UI : rows[]
UI->>Bridge : electronAPI.lan.clientStatus()
Bridge->>Main : ipcRenderer.invoke("lan : client-status")
Main-->>Bridge : {connected, wsReadyState}
Bridge-->>UI : status
UI->>Bridge : electronAPI.lan.connect(config)
Bridge->>Main : ipcRenderer.invoke("lan : client : connect", config)
Main->>LANC : createLanClient(config).connect()
LANC-->>Main : connected?
Main-->>Bridge : {success, error?}
Bridge-->>UI : result
```

**Diagram sources**
- [electron/preload.ts:1-90](file://electron/preload.ts#L1-L90)
- [electron/main.ts:126-391](file://electron/main.ts#L126-L391)
- [electron/services/localDb.ts:247-268](file://electron/services/localDb.ts#L247-L268)
- [electron/services/lanClient.ts:65-144](file://electron/services/lanClient.ts#L65-L144)
- [electron/services/sqliteLanServer.ts:431-474](file://electron/services/sqliteLanServer.ts#L431-L474)

## Detailed Component Analysis

### Main Process
Responsibilities:
- Create BrowserWindow with preload and strict webPreferences.
- Register IPC handlers for:
  - Printer: list devices, connect, print raw, disconnect, Windows printer helpers.
  - Database: query, upsert, get pending, delete, clear table.
  - Sync: start, stop, status, force (deprecated).
  - LAN: server start/stop, client connect/disconnect, status, HTTP API wrappers, event forwarding.
- Manage app lifecycle: start services on ready, stop on window-all-closed.

```mermaid
flowchart TD
Start(["App Ready"]) --> RegHandlers["Register IPC Handlers"]
RegHandlers --> CreateWin["Create BrowserWindow<br/>preload: preload.js"]
CreateWin --> RunUI["Load Renderer"]
RunUI --> Shutdown{"Window All Closed?"}
Shutdown --> |Yes| StopSync["Stop SyncEngine"]
StopSync --> StopLanSrv["Stop LAN Server"]
StopLanSrv --> StopLanCli["Destroy LAN Client"]
StopLanCli --> DisconnectPrinter["Disconnect Printer"]
DisconnectPrinter --> Quit["Quit App"]
Shutdown --> |No| RunUI
```

**Diagram sources**
- [electron/main.ts:394-438](file://electron/main.ts#L394-L438)

**Section sources**
- [electron/main.ts:20-50](file://electron/main.ts#L20-L50)
- [electron/main.ts:52-124](file://electron/main.ts#L52-L124)
- [electron/main.ts:126-175](file://electron/main.ts#L126-L175)
- [electron/main.ts:177-224](file://electron/main.ts#L177-L224)
- [electron/main.ts:226-391](file://electron/main.ts#L226-L391)
- [electron/main.ts:393-450](file://electron/main.ts#L393-L450)

### Preload Bridge
Responsibilities:
- Expose electronAPI to renderer via contextBridge.
- Provide typed methods for printer, database, sync, LAN, and app reset.
- Support event subscriptions for LAN connection and record changes.

```mermaid
classDiagram
class PreloadAPI {
+printer : PrinterAPI
+db : DBAPI
+sync : SyncAPI
+lan : LANAPI
+isElectron : boolean
+app : AppAPI
}
class PrinterAPI {
+listDevices()
+connect(vendorId, productId)
+print(receiptData)
+disconnect()
}
class DBAPI {
+query(table, filters)
+upsert(table, data)
+getPending()
+delete(table, id)
+clearTable(table)
}
class SyncAPI {
+start(supabaseUrl, supabaseKey, accessToken)
+stop()
+status()
+force()
}
class LANAPI {
+startServer()
+stopServer()
+connect(config)
+disconnect()
+status()
+clientStatus()
+query(table, filters)
+upsert(table, data)
+delete(table, id)
+getKitchenOrders(kitchenId?, status?)
+updateOrderItemStatus(itemId, status)
+onConnected(cb)
+onDisconnected(cb)
+onRecordChanged(cb)
+onOrderStatusChanged(cb)
}
class AppAPI {
+resetAllData()
}
PreloadAPI --> PrinterAPI
PreloadAPI --> DBAPI
PreloadAPI --> SyncAPI
PreloadAPI --> LANAPI
PreloadAPI --> AppAPI
```

**Diagram sources**
- [electron/preload.ts:4-89](file://electron/preload.ts#L4-L89)

**Section sources**
- [electron/preload.ts:1-90](file://electron/preload.ts#L1-L90)

### Native Printer Service
Capabilities:
- Enumerate USB devices and filter by known thermal printer vendor IDs.
- Connect via libusb bulk endpoint or fall back to Windows raw port/spooler.
- Print raw ESC/POS buffers with chunked transfers.
- Windows-specific helpers: list matching printers by VID/PID, switch printers, and list all matching printers.

```mermaid
flowchart TD
Start(["Connect(vendorId, productId)"]) --> TryLibusb["Try libusb claim interface"]
TryLibusb --> LibusbOk{"Claim OK?"}
LibusbOk --> |Yes| UseUSB["Use USB bulk OUT endpoint"]
LibusbOk --> |No| WinFallback["Find Windows printer by VID/PID"]
WinFallback --> FoundWin{"Windows printer found?"}
FoundWin --> |Yes| UseWin["Use Windows raw port/spooler"]
FoundWin --> |No| Error["Throw error"]
UseUSB --> Done(["Connected"])
UseWin --> Done
```

**Diagram sources**
- [electron/services/nativePrinter.ts:101-201](file://electron/services/nativePrinter.ts#L101-L201)
- [electron/services/nativePrinter.ts:207-229](file://electron/services/nativePrinter.ts#L207-L229)
- [electron/services/nativePrinter.ts:429-450](file://electron/services/nativePrinter.ts#L429-L450)

**Section sources**
- [electron/services/nativePrinter.ts:1-542](file://electron/services/nativePrinter.ts#L1-L542)

### Local Database (Offline-First)
Design:
- Uses better-sqlite3 with WAL mode and foreign keys enabled.
- Mirrors Supabase tables with sync_status tracking and indexes.
- Provides query, upsert (ON CONFLICT), bulkUpsert, getPendingSync, markSynced, delete, clear, and last sync time.

```mermaid
erDiagram
ORDERS {
text id PK
text restaurant_id
text table_id
text status
real total_amount
text payment_method
text notes
text customer_name
text customer_phone
text customer_gstin
text created_at
text updated_at
text sync_status
}
ORDER_ITEMS {
text id PK
text order_id FK
text menu_item_id
text kitchen_id
int quantity
real unit_price
text notes
text status
text created_at
text updated_at
text sync_status
}
MENU_CATEGORIES {
text id PK
text restaurant_id
text name
text description
int sort_order
int is_active
text created_at
text updated_at
text sync_status
}
MENU_ITEMS {
text id PK
text category_id FK
text kitchen_id
text name
text description
real price
text food_type
text spice_level
int is_available
int preparation_time
text image_url
text created_at
text updated_at
text sync_status
}
KITCHENS {
text id PK
text restaurant_id
text name
text description
int is_active
text created_at
text updated_at
text sync_status
}
FLOORS {
text id PK
text restaurant_id
text name
int floor_number
text created_at
text updated_at
text sync_status
}
TABLES {
text id PK
text floor_id FK
text table_number
int capacity
int is_occupied
text current_order_id
text occupied_since
text created_at
text updated_at
text sync_status
}
RESTAURANTS {
text id PK
text name
text slug
text address
text phone
text gstin
real cgst_percentage
real sgst_percentage
text owner_id
text created_at
text updated_at
text sync_status
}
STAFF_MEMBERS {
text id PK
text restaurant_id
text user_id
text full_name
text email
text phone
text role
int is_active
text invited_at
text joined_at
text created_at
text updated_at
text sync_status
}
SYNC_LOG {
int id PK
text table_name
text record_id
text action
text synced_at
}
ORDERS ||--o{ ORDER_ITEMS : "has"
MENU_CATEGORIES ||--o{ MENU_ITEMS : "contains"
FLOORS ||--o{ TABLES : "contains"
RESTAURANTS ||--o{ KITCHENS : "owns"
RESTAURANTS ||--o{ STAFF_MEMBERS : "employs"
```

**Diagram sources**
- [electron/services/localDb.ts:15-160](file://electron/services/localDb.ts#L15-L160)

**Section sources**
- [electron/services/localDb.ts:1-401](file://electron/services/localDb.ts#L1-L401)

### Sync Engine
Behavior:
- One-time pull from Supabase to local SQLite on app start when online.
- Manual push is disabled/deprecated; push is triggered from renderer UI.
- Online detection via HEAD request to Supabase.

```mermaid
sequenceDiagram
participant UI as "Renderer"
participant Main as "Main Process"
participant Sync as "SyncEngine"
participant DB as "LocalDatabase"
participant Cloud as "Supabase"
UI->>Main : ipcRenderer.invoke("sync : start", url, key, token)
Main->>Sync : startSync(token)
Sync->>Sync : checkOnline()
alt Online
Sync->>Cloud : fetch tables with updated_at filter
Cloud-->>Sync : records[]
Sync->>DB : bulkUpsert(table, records)
else Offline
Sync-->>Main : online=false
end
Main-->>UI : {success}
```

**Diagram sources**
- [electron/main.ts:177-224](file://electron/main.ts#L177-L224)
- [electron/services/syncEngine.ts:32-106](file://electron/services/syncEngine.ts#L32-L106)

**Section sources**
- [electron/services/syncEngine.ts:1-124](file://electron/services/syncEngine.ts#L1-L124)

### LAN Client and Server
- LAN Server: Express + WebSocket server with SQLite backend, exposes HTTP CRUD endpoints and broadcasts changes to clients.
- LAN Client: Registers device, maintains WebSocket, handles record change and order status events, queues messages until connected.

```mermaid
sequenceDiagram
participant Billing as "Billing Client"
participant Server as "LAN Server"
participant Kitchen as "Kitchen Client"
Billing->>Server : HTTP GET /health
Server-->>Billing : {status, clients}
Billing->>Server : WS connect
Billing->>Server : {"type" : "register", "deviceId","deviceType","deviceName"}
Server-->>Billing : {"type" : "registered"}
Server-->>Kitchen : broadcast {"type" : "record_changed", ...}
Kitchen-->>Server : {"type" : "ping"} (every 30s)
```

**Diagram sources**
- [electron/services/sqliteLanServer.ts:52-189](file://electron/services/sqliteLanServer.ts#L52-L189)
- [electron/services/sqliteLanServer.ts:191-229](file://electron/services/sqliteLanServer.ts#L191-L229)
- [electron/services/lanClient.ts:65-144](file://electron/services/lanClient.ts#L65-L144)
- [electron/services/lanClient.ts:146-164](file://electron/services/lanClient.ts#L146-L164)

**Section sources**
- [electron/services/lanClient.ts:1-364](file://electron/services/lanClient.ts#L1-L364)
- [electron/services/sqliteLanServer.ts:1-520](file://electron/services/sqliteLanServer.ts#L1-L520)

### Web Thermal Printer (Browser Path)
The renderer-side thermal printer service supports:
- Mobile: Capacitor-based Bluetooth printing.
- Desktop/Browser: HTML-to-print rendering with window.print.

Note: This is separate from the Electron-native printer service and is used when running in a browser context.

**Section sources**
- [src/services/thermalPrinter.ts:1-339](file://src/services/thermalPrinter.ts#L1-L339)

## Dependency Analysis
External native modules and integrations:
- better-sqlite3: Local database and LAN server storage.
- usb: Direct USB device enumeration and bulk transfer for printer.
- express + ws + cors: LAN server HTTP and WebSocket endpoints.
- node child_process: Windows PowerShell-based raw printing fallback.
- electron-builder: Packaging for Windows installer.

```mermaid
graph LR
Main["Main Process"] --> Better["better-sqlite3"]
Main --> USB["usb"]
Main --> Express["express"]
Main --> WS["ws"]
Main --> CORS["cors"]
Main --> ChildProc["child_process"]
Main --> Electron["electron"]
Preload["Preload Bridge"] --> Electron
Vite["Vite Config"] --> ElectronPlugin["vite-plugin-electron"]
Vite --> ElectronRenderer["vite-plugin-electron-renderer"]
Package["package.json"] --> Builder["electron-builder"]
Package --> Rebuild["electron-rebuild"]
```

**Diagram sources**
- [package.json:13-131](file://package.json#L13-L131)
- [vite.config.ts:21-60](file://vite.config.ts#L21-L60)
- [electron/main.ts:1-11](file://electron/main.ts#L1-L11)

**Section sources**
- [package.json:17-106](file://package.json#L17-L106)
- [vite.config.ts:18-61](file://vite.config.ts#L18-L61)

## Performance Considerations
- SQLite WAL mode improves concurrency and write throughput for the LAN server.
- Chunked USB transfers prevent buffer overflows and improve reliability.
- LAN client queues messages until WebSocket opens to reduce lost updates.
- SyncEngine performs one-time pull; push is manual to avoid network contention.
- Consider batching database upserts and deferring heavy UI work during LAN broadcasts.

## Security Considerations
- Context isolation enabled; preload bridge exposes only explicit APIs.
- IPC handlers validate inputs and return structured {success,error} responses.
- Windows raw printing uses PowerShell with temporary files; ensure least-privilege execution and secure temp directories.
- LAN server listens locally; restrict exposure and monitor client counts.
- Avoid exposing internal paths or sensitive data in error responses.

**Section sources**
- [electron/main.ts:27-32](file://electron/main.ts#L27-L32)
- [electron/preload.ts:1-90](file://electron/preload.ts#L1-L90)
- [electron/services/nativePrinter.ts:455-509](file://electron/services/nativePrinter.ts#L455-L509)

## Build and Packaging
- Scripts:
  - dev: Vite dev server.
  - dev:electron: Vite with electron mode.
  - build: Vite build.
  - build:electron: Vite electron build followed by electron-builder.
  - postinstall: electron-rebuild for native modules (better-sqlite3, usb).
- Vite plugin wiring:
  - Electron main entry with externalized native modules.
  - Preload build as CJS library.
  - Renderer plugin for compatibility.
- electron-builder configuration:
  - appId, productName, output directory.
  - Windows target nsis with installer options.

```mermaid
flowchart TD
Dev["npm run dev"] --> ViteDev["Vite Dev Server"]
ElectronDev["npm run dev:electron"] --> ViteElectron["Vite Electron Mode"]
Build["npm run build"] --> Dist["dist/"]
BuildElectron["npm run build:electron"] --> DistElectron["dist-electron/"]
DistElectron --> Builder["electron-builder"]
Builder --> Installer["NSIS Installer (Windows)"]
```

**Diagram sources**
- [package.json:7-16](file://package.json#L7-L16)
- [vite.config.ts:21-60](file://vite.config.ts#L21-L60)
- [package.json:107-129](file://package.json#L107-L129)

**Section sources**
- [package.json:7-16](file://package.json#L7-L16)
- [package.json:107-129](file://package.json#L107-L129)
- [vite.config.ts:18-61](file://vite.config.ts#L18-L61)

## Troubleshooting Guide
Common issues and remedies:
- USB printer not found:
  - Ensure the device is connected and not a hub/HID device.
  - Install WinUSB driver using Zadig for direct USB access.
- Windows raw printing fails:
  - Verify a thermal/receipt printer is installed with a USB port.
  - Use the Windows printer selection helpers to choose the correct printer.
- LAN server fails to start:
  - Check port 3333 availability; stop other instances.
  - Confirm data directory creation permissions.
- LAN client disconnects:
  - Inspect reconnect timer and ping intervals.
  - Validate server health endpoint and firewall rules.
- Sync pull does not occur:
  - Confirm online connectivity and Supabase credentials.
  - Check initial pull logs and table filters.

**Section sources**
- [electron/services/nativePrinter.ts:113-121](file://electron/services/nativePrinter.ts#L113-L121)
- [electron/services/nativePrinter.ts:213-218](file://electron/services/nativePrinter.ts#L213-L218)
- [electron/services/sqliteLanServer.ts:458-467](file://electron/services/sqliteLanServer.ts#L458-L467)
- [electron/services/lanClient.ts:178-186](file://electron/services/lanClient.ts#L178-L186)
- [electron/services/syncEngine.ts:109-122](file://electron/services/syncEngine.ts#L109-L122)

## Conclusion
The desktop integration leverages a clean separation of concerns: a secure main process with explicit IPC handlers, a minimal preload bridge, robust offline-first SQLite, and a LAN stack for multi-device collaboration. Native printer support is comprehensive with USB and Windows fallbacks. Packaging uses electron-builder for Windows NSIS installers. Adhering to the documented patterns ensures maintainability and reliability across platforms.