# Staff Performance Reports

<cite>
**Referenced Files in This Document**
- [Reports.tsx](file://src/pages/dashboard/Reports.tsx)
- [Staff.tsx](file://src/pages/dashboard/Staff.tsx)
- [ShiftScheduler.tsx](file://src/components/staff/ShiftScheduler.tsx)
- [useStaffMembers.ts](file://src/hooks/useStaffMembers.ts)
- [types.ts](file://src/integrations/supabase/types.ts)
- [offlineDataService.ts](file://src/services/offlineDataService.ts)
- [Orders.tsx](file://src/pages/dashboard/Orders.tsx)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document provides comprehensive staff performance reporting documentation for TableFlow Pro. It explains how to analyze staff productivity metrics (orders handled per shift, completion rates, peak performance hours), integrate scheduling for accurate performance attribution, and track individual contributions. It also covers performance ranking, commission calculation patterns, and team analytics, while detailing the integration with the staff management system and order assignment tracking.

## Project Structure
TableFlow Pro organizes staff performance reporting around:
- Reports dashboard for analytics and historical order tracking
- Staff management for adding, editing, and scheduling employees
- Hooks and services that provide offline-first data access and synchronization
- Supabase schema types that define the underlying data model

```mermaid
graph TB
subgraph "UI Pages"
Reports["Reports.tsx"]
Staff["Staff.tsx"]
Orders["Orders.tsx"]
end
subgraph "Components"
ShiftScheduler["ShiftScheduler.tsx"]
end
subgraph "Hooks & Services"
useStaff["useStaffMembers.ts"]
offlineSvc["offlineDataService.ts"]
end
subgraph "Data Model"
types["types.ts"]
end
Reports --> offlineSvc
Staff --> useStaff
Reports --> useStaff
Reports --> Orders
Staff --> ShiftScheduler
Reports --> types
Staff --> types
Orders --> types
```

**Diagram sources**
- [Reports.tsx:580-2156](file://src/pages/dashboard/Reports.tsx#L580-L2156)
- [Staff.tsx:15-204](file://src/pages/dashboard/Staff.tsx#L15-L204)
- [ShiftScheduler.tsx:40-274](file://src/components/staff/ShiftScheduler.tsx#L40-L274)
- [useStaffMembers.ts:36-254](file://src/hooks/useStaffMembers.ts#L36-L254)
- [offlineDataService.ts:151-287](file://src/services/offlineDataService.ts#L151-L287)
- [types.ts:465-515](file://src/integrations/supabase/types.ts#L465-L515)

**Section sources**
- [Reports.tsx:580-2156](file://src/pages/dashboard/Reports.tsx#L580-L2156)
- [Staff.tsx:15-204](file://src/pages/dashboard/Staff.tsx#L15-L204)
- [ShiftScheduler.tsx:40-274](file://src/components/staff/ShiftScheduler.tsx#L40-L274)
- [useStaffMembers.ts:36-254](file://src/hooks/useStaffMembers.ts#L36-L254)
- [offlineDataService.ts:151-287](file://src/services/offlineDataService.ts#L151-L287)
- [types.ts:465-515](file://src/integrations/supabase/types.ts#L465-L515)

## Core Components
- Reports dashboard: Aggregates order data, computes performance metrics, and visualizes analytics.
- Staff management: Adds/editing staff, toggles activity, and manages schedules.
- Shift scheduler: Weekly view for assigning staff to shifts.
- Data hooks: Fetch and mutate staff and shift data with offline-first caching.
- Offline service: SQLite-first data access with optional cloud sync.

Key responsibilities:
- Staff productivity metrics: Orders handled per shift, completion rates, peak hours.
- Performance attribution: Link orders to staff via created_by or assignment patterns.
- Ranking and commission: Use served orders and quantities as basis for ranking; derive commission from revenue or fixed percentages.
- Team analytics: Compare throughput, revenue, and efficiency across roles.

**Section sources**
- [Reports.tsx:902-942](file://src/pages/dashboard/Reports.tsx#L902-L942)
- [Reports.tsx:967-1010](file://src/pages/dashboard/Reports.tsx#L967-L1010)
- [Staff.tsx:15-204](file://src/pages/dashboard/Staff.tsx#L15-L204)
- [ShiftScheduler.tsx:40-274](file://src/components/staff/ShiftScheduler.tsx#L40-L274)
- [useStaffMembers.ts:36-254](file://src/hooks/useStaffMembers.ts#L36-L254)
- [offlineDataService.ts:151-287](file://src/services/offlineDataService.ts#L151-L287)

## Architecture Overview
The system integrates staff and order data to produce performance insights. The Reports page consumes order data and applies filters by date range and status. Staff and shift data are fetched via hooks and used to attribute performance to individuals or roles.

```mermaid
sequenceDiagram
participant UI as "Reports UI"
participant Hook as "useStaffMembers"
participant Orders as "Orders Page"
participant Offline as "offlineQuery/offlineMutate"
participant Supabase as "Supabase"
UI->>Hook : Fetch staff and shifts
Hook->>Offline : offlineQuery(staff_members, shifts)
Offline->>Supabase : Query tables (if online)
Supabase-->>Offline : Data
Offline-->>Hook : Data or cache
UI->>Orders : Load orders with filters
Orders->>Offline : offlineQuery(orders, order_items)
Offline->>Supabase : Query orders (if online)
Supabase-->>Offline : Data
Offline-->>Orders : Data or cache
UI->>UI : Compute metrics (completion, hourly, daily)
UI->>UI : Render charts and tables
```

**Diagram sources**
- [Reports.tsx:718-882](file://src/pages/dashboard/Reports.tsx#L718-L882)
- [useStaffMembers.ts:36-143](file://src/hooks/useStaffMembers.ts#L36-L143)
- [offlineDataService.ts:151-211](file://src/services/offlineDataService.ts#L151-L211)
- [Orders.tsx:170-289](file://src/pages/dashboard/Orders.tsx#L170-L289)

**Section sources**
- [Reports.tsx:718-882](file://src/pages/dashboard/Reports.tsx#L718-L882)
- [useStaffMembers.ts:36-143](file://src/hooks/useStaffMembers.ts#L36-L143)
- [offlineDataService.ts:151-211](file://src/services/offlineDataService.ts#L151-L211)
- [Orders.tsx:170-289](file://src/pages/dashboard/Orders.tsx#L170-L289)

## Detailed Component Analysis

### Staff Productivity Metrics
The Reports page calculates key productivity metrics:
- Completed orders and cancellation counts
- Average order value
- Revenue by payment method (cash, online, unpaid)
- Hourly and daily throughput
- Status distribution pie chart

These metrics enable:
- Orders handled per shift: Count served orders during each shift period.
- Completion rates: Ratio of served to total orders in a period.
- Peak performance hours: Hourly order volume and revenue spikes.

```mermaid
flowchart TD
Start(["Load Orders"]) --> Filter["Filter by date range and status"]
Filter --> Stats["Compute stats:<br/>- Completed<br/>- Cancelled<br/>- Pending<br/>- Revenue<br/>- Avg. Order Value"]
Stats --> Hourly["Aggregate hourly data"]
Stats --> Daily["Aggregate daily data"]
Hourly --> Charts["Render charts"]
Daily --> Charts
Charts --> Output(["Display metrics"])
```

**Diagram sources**
- [Reports.tsx:902-942](file://src/pages/dashboard/Reports.tsx#L902-L942)
- [Reports.tsx:967-1010](file://src/pages/dashboard/Reports.tsx#L967-L1010)

**Section sources**
- [Reports.tsx:902-942](file://src/pages/dashboard/Reports.tsx#L902-L942)
- [Reports.tsx:967-1010](file://src/pages/dashboard/Reports.tsx#L967-L1010)

### Staff Scheduling Integration
The Staff page and ShiftScheduler component provide weekly scheduling:
- Active staff filtering
- Weekly calendar view with shift creation and deletion
- Assignment of staff to specific dates and times

```mermaid
sequenceDiagram
participant Manager as "Manager"
participant StaffPage as "Staff.tsx"
participant Scheduler as "ShiftScheduler.tsx"
participant Hook as "useShifts"
participant Offline as "offlineMutate"
Manager->>StaffPage : Open Staff tab
StaffPage->>Hook : fetchShifts()
Hook->>Offline : offlineQuery(shifts)
Offline-->>Hook : Shifts data
Hook-->>StaffPage : Shifts data
Manager->>Scheduler : Click Add Shift
Scheduler->>Hook : addShift()
Hook->>Offline : offlineMutate(shifts)
Offline-->>Hook : Success/Error
Hook-->>Scheduler : Updated shifts
Scheduler-->>Manager : Shift added
```

**Diagram sources**
- [Staff.tsx:183-191](file://src/pages/dashboard/Staff.tsx#L183-L191)
- [ShiftScheduler.tsx:88-108](file://src/components/staff/ShiftScheduler.tsx#L88-L108)
- [useStaffMembers.ts:192-217](file://src/hooks/useStaffMembers.ts#L192-L217)
- [offlineDataService.ts:220-287](file://src/services/offlineDataService.ts#L220-L287)

**Section sources**
- [Staff.tsx:183-191](file://src/pages/dashboard/Staff.tsx#L183-L191)
- [ShiftScheduler.tsx:40-274](file://src/components/staff/ShiftScheduler.tsx#L40-L274)
- [useStaffMembers.ts:145-254](file://src/hooks/useStaffMembers.ts#L145-L254)
- [offlineDataService.ts:220-287](file://src/services/offlineDataService.ts#L220-L287)

### Performance Attribution and Order Assignment Tracking
Current schema supports:
- Orders with created_at, status, total_amount, payment_method
- Optional created_by field present in local SQLite schema (migration proposal)

Attribution patterns:
- Link served orders to staff via created_by (requires schema alignment)
- Use shift-based grouping to attribute performance to specific shifts
- Combine served orders with shift assignments to compute per-staff metrics

```mermaid
erDiagram
ORDERS {
uuid id PK
uuid restaurant_id FK
uuid table_id FK
enum status
number total_amount
text payment_method
text created_by
timestamp created_at
}
STAFF_MEMBERS {
uuid id PK
uuid restaurant_id FK
text full_name
text email
text phone
enum role
boolean is_active
timestamp created_at
}
SHIFTS {
uuid id PK
uuid restaurant_id FK
uuid staff_member_id FK
date shift_date
time start_time
time end_time
text notes
timestamp created_at
}
ORDERS }o--|| STAFF_MEMBERS : "created_by"
STAFF_MEMBERS ||--o{ SHIFTS : "assigned_to"
```

**Diagram sources**
- [types.ts:342-392](file://src/integrations/supabase/types.ts#L342-L392)
- [types.ts:516-530](file://src/integrations/supabase/types.ts#L516-L530)
- [types.ts:465-499](file://src/integrations/supabase/types.ts#L465-L499)
- [IMPLEMENTATION_CHECKLIST.md:438-466](file://IMPLEMENTATION_CHECKLIST.md#L438-L466)

**Section sources**
- [types.ts:342-392](file://src/integrations/supabase/types.ts#L342-L392)
- [types.ts:516-530](file://src/integrations/supabase/types.ts#L516-L530)
- [types.ts:465-499](file://src/integrations/supabase/types.ts#L465-L499)
- [IMPLEMENTATION_CHECKLIST.md:438-466](file://IMPLEMENTATION_CHECKLIST.md#L438-L466)

### Staff Commission Calculations and Rankings
Commission calculation patterns:
- Fixed percentage per served order
- Revenue share based on item revenue
- Tiered bonuses for exceeding targets

Rankings:
- Orders handled per period
- Revenue generated per period
- Efficiency metrics (avg. time per order)

```mermaid
flowchart TD
A["Select Period"] --> B["Filter served orders"]
B --> C["Compute per-staff totals:<br/>- Orders handled<br/>- Revenue generated"]
C --> D["Apply commission formula:<br/>- Fixed % per order<br/>- Revenue share<br/>- Bonuses"]
D --> E["Rank staff:<br/>- By orders handled<br/>- By revenue<br/>- By efficiency"]
E --> F["Generate report"]
```

[No sources needed since this diagram shows conceptual workflow, not actual code structure]

### Staff Performance Dashboards and Reviews
- Dashboard cards: Revenue, completed orders, average order value, pending orders
- Payment method breakdown: Cash vs. online vs. unpaid
- Top selling items: Quantity and revenue
- Analytics charts: Hourly/daily trends, status distribution, top items comparison
- History tab: Filterable order list with pagination

```mermaid
graph TB
Summary["Summary Cards"] --> Revenue["Revenue"]
Summary --> Orders["Completed Orders"]
Summary --> AOV["Avg. Order Value"]
Summary --> Pending["Pending Orders"]
Analytics["Analytics Charts"] --> Hourly["Hourly Orders & Revenue"]
Analytics --> Status["Status Distribution"]
Analytics --> TopItems["Top Items (Qty & Revenue)"]
History["Order History"] --> Filters["Status & Payment Filters"]
History --> List["Paginated Order List"]
```

**Diagram sources**
- [Reports.tsx:1503-1689](file://src/pages/dashboard/Reports.tsx#L1503-L1689)
- [Reports.tsx:1693-1832](file://src/pages/dashboard/Reports.tsx#L1693-L1832)
- [Reports.tsx:1835-2018](file://src/pages/dashboard/Reports.tsx#L1835-L2018)

**Section sources**
- [Reports.tsx:1503-1689](file://src/pages/dashboard/Reports.tsx#L1503-L1689)
- [Reports.tsx:1693-1832](file://src/pages/dashboard/Reports.tsx#L1693-L1832)
- [Reports.tsx:1835-2018](file://src/pages/dashboard/Reports.tsx#L1835-L2018)

## Dependency Analysis
- Reports depends on:
  - Orders data for served/completion metrics
  - Staff and shift data for attribution
  - Offline service for data access and caching
- Staff management depends on:
  - Staff and shift hooks
  - Offline service for mutations
- Supabase types define the schema for orders, staff_members, and shifts

```mermaid
graph LR
Reports["Reports.tsx"] --> OrdersData["Orders data"]
Reports --> StaffData["Staff data"]
Reports --> Offline["offlineDataService.ts"]
Staff["Staff.tsx"] --> Shifts["useShifts hook"]
Staff --> Offline
OrdersData --> Types["types.ts"]
StaffData --> Types
Shifts --> Types
```

**Diagram sources**
- [Reports.tsx:718-882](file://src/pages/dashboard/Reports.tsx#L718-L882)
- [Staff.tsx:183-191](file://src/pages/dashboard/Staff.tsx#L183-L191)
- [useStaffMembers.ts:145-254](file://src/hooks/useStaffMembers.ts#L145-L254)
- [offlineDataService.ts:151-211](file://src/services/offlineDataService.ts#L151-L211)
- [types.ts:465-515](file://src/integrations/supabase/types.ts#L465-L515)

**Section sources**
- [Reports.tsx:718-882](file://src/pages/dashboard/Reports.tsx#L718-L882)
- [Staff.tsx:183-191](file://src/pages/dashboard/Staff.tsx#L183-L191)
- [useStaffMembers.ts:145-254](file://src/hooks/useStaffMembers.ts#L145-L254)
- [offlineDataService.ts:151-211](file://src/services/offlineDataService.ts#L151-L211)
- [types.ts:465-515](file://src/integrations/supabase/types.ts#L465-L515)

## Performance Considerations
- Offline-first architecture ensures availability without network connectivity.
- Local caching reduces repeated cloud queries and improves responsiveness.
- Use date-range filters and pagination to limit dataset sizes.
- Prefer indexed queries for shifts and orders to improve performance.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- No data displayed: Verify restaurant selection and date range filters.
- Offline mode limitations: Confirm local SQLite availability and data presence.
- Sync conflicts: Use manual sync to upload pending changes to cloud.
- Shift creation failures: Ensure staff member is active and valid date/time selections.

**Section sources**
- [offlineDataService.ts:351-372](file://src/services/offlineDataService.ts#L351-L372)
- [offlineDataService.ts:397-541](file://src/services/offlineDataService.ts#L397-L541)
- [ShiftScheduler.tsx:88-108](file://src/components/staff/ShiftScheduler.tsx#L88-L108)

## Conclusion
TableFlow Pro’s Reports and Staff modules provide a robust foundation for staff performance reporting. By leveraging served order data, shift schedules, and offline-first data access, managers can track productivity, identify peak performance hours, attribute performance to individuals, and generate actionable insights. Extending the schema with created_by and implementing commission formulas will further enhance the system’s analytical capabilities.