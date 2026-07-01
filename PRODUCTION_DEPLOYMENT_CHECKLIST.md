# Production Deployment Checklist

## 🚀 TableFlow Pro - Production Release

**Version**: 1.0.0  
**Release Date**: April 14, 2026  
**Status**: Ready for Production ✅

---

## 📋 Pre-Deployment Checklist

### 1. Code Quality & Reviews

- [ ] All Phase 1-4 implementations complete
- [ ] Code review completed for all changes
- [ ] No TypeScript errors or warnings
- [ ] No ESLint errors
- [ ] No console errors in development mode
- [ ] All merge conflicts resolved
- [ ] Git branch is clean and up to date

**Commands to verify**:
```bash
# Check for TypeScript errors
npm run type-check

# Check for linting errors
npm run lint

# Build without errors
npm run build
```

---

### 2. Database Migrations

- [ ] Supabase migration applied successfully
  - File: `supabase/migrations/20260414000000_add_customer_fields_to_orders.sql`
  - Migration ran without errors
  - Verified new columns exist in `orders` table

**Verification SQL**:
```sql
-- Verify columns were added
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'orders' 
  AND column_name IN (
    'customer_name', 'customer_phone', 'customer_gstin',
    'payment_status', 'cgst_amount', 'sgst_amount',
    'discount_amount', 'final_amount', 'created_by'
  );

-- Expected: 9 rows returned

-- Verify indexes were created
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'orders' 
  AND indexname LIKE 'idx_orders_%';

-- Expected: 4 rows returned
```

- [ ] No existing data was affected by migration
- [ ] Android app continues to work (verified no breaking changes)
- [ ] Backup of Supabase database created (optional but recommended)

---

### 3. Environment Configuration

- [ ] `.env` file contains correct Supabase credentials
  ```env
  VITE_SUPABASE_URL=https://your-project.supabase.co
  VITE_SUPABASE_ANON_KEY=your-anon-key
  ```

- [ ] Electron builder configuration verified
  - File: `package.json` → `build` section
  - App name: "RestroFlow" (or "TableFlow Pro")
  - Version number updated
  - Windows installer configured (NSIS)

- [ ] No hardcoded IP addresses or secrets in code
- [ ] All API endpoints use environment variables

**Check for secrets**:
```bash
# Search for hardcoded credentials
grep -r "supabase.co" src/ --include="*.ts" --include="*.tsx"
grep -r "password" src/ --include="*.ts" --include="*.tsx"
grep -r "secret" src/ --include="*.ts" --include="*.tsx"
```

---

### 4. Dependencies & Security

- [ ] All dependencies up to date
- [ ] No known security vulnerabilities
- [ ] `package-lock.json` committed
- [ ] `node_modules` excluded from git (in `.gitignore`)

**Commands**:
```bash
# Check for vulnerabilities
npm audit

# Update dependencies (if needed)
npm update

# Rebuild with fresh dependencies
rm -rf node_modules
npm install
```

---

## 🧪 Testing Checklist

### 5. Core Functionality Tests

#### Orders Management
- [ ] Create new order
- [ ] Add items to order
- [ ] Update order status (pending → confirmed → preparing → ready → served → completed)
- [ ] Apply discount to order
- [ ] Calculate taxes (CGST/SGST) correctly
- [ ] Mark order as paid
- [ ] Delete/cancel order
- [ ] View order history
- [ ] Print bill/KOT

#### Menu Management
- [ ] Create menu category
- [ ] Add menu item with price
- [ ] Edit menu item (name, price, description)
- [ ] Toggle item availability (in stock / out of stock)
- [ ] Delete menu item
- [ ] Set food type (veg, non-veg, egg, vegan, jain)
- [ ] Set spice level
- [ ] Assign to kitchen

#### Table & Floor Management
- [ ] Create floor
- [ ] Add tables to floor
- [ ] Set table capacity
- [ ] Mark table as occupied
- [ ] Mark table as available
- [ ] Assign order to table
- [ ] Delete floor/table

#### Kitchen Display
- [ ] View incoming orders in kitchen
- [ ] Update order item status (pending → preparing → ready → served)
- [ ] Filter orders by kitchen
- [ ] Real-time order updates
- [ ] Print KOT from kitchen

#### Staff Management
- [ ] Invite staff member
- [ ] Assign role (admin, manager, waiter, cashier, chef, host, runner)
- [ ] Activate/deactivate staff
- [ ] View staff list
- [ ] Edit staff details

---

### 6. Offline Mode Tests

#### Offline Operations
- [ ] Disconnect internet
- [ ] Load all pages (should use SQLite cache)
- [ ] Create order while offline
- [ ] Update menu while offline
- [ ] Add staff member while offline
- [ ] All offline operations save to local SQLite
- [ ] Reconnect internet
- [ ] Verify offline data synced to Supabase
- [ ] Check sync status indicator shows "Synced"

#### Cache Behavior
- [ ] Fresh install downloads all data from Supabase
- [ ] Subsequent launches use local cache
- [ ] Cache updates when data changes
- [ ] Cache persists across app restarts

---

### 7. LAN Mode Tests

#### LAN Server Setup
- [ ] Start app as LAN Server
- [ ] Server starts on correct IP and port (default: 3333)
- [ ] Server shows connection details in console
- [ ] Server database initializes correctly

#### LAN Client Connection
- [ ] Start app as LAN Client
- [ ] Client connects to server IP
- [ ] Connection status shows "Connected"
- [ ] Client can query data from server
- [ ] Client can create/update/delete data via server
- [ ] Real-time updates work (WebSocket)

#### Multi-Client Scenarios
- [ ] Multiple clients connect to same server
- [ ] Client A creates order → Client B sees it immediately
- [ ] Client A updates menu → Client B sees update
- [ ] No data conflicts between clients
- [ ] Server handles concurrent requests

#### LAN Server Resilience
- [ ] Server restarts automatically on crash
- [ ] Port conflict handling works
- [ ] Server recovers after network interruption
- [ ] Clients reconnect automatically

---

### 8. Data Validation Tests

#### Invalid Data Rejection
- [ ] Try to create order with negative amount → Rejected ✅
- [ ] Try to create order with invalid UUID → Rejected ✅
- [ ] Try to create menu item with price = -50 → Rejected ✅
- [ ] Try to create staff with invalid email → Rejected ✅
- [ ] Try to create order with invalid payment status → Rejected ✅
- [ ] Try to create order item with quantity = 0 → Rejected ✅

#### Valid Data Acceptance
- [ ] Create order with all customer fields → Accepted ✅
- [ ] Create order with GSTIN → Accepted ✅
- [ ] Create menu item with all fields → Accepted ✅
- [ ] Create staff with valid email/phone → Accepted ✅

#### Edge Cases
- [ ] Create order with maximum items
- [ ] Create order with special characters in notes
- [ ] Create menu item with very long name (200 chars)
- [ ] Create order with zero discount
- [ ] Create order with 100% discount

---

### 9. Batch Operations Tests

#### Batch Upsert
- [ ] Sync 100+ records from Supabase → Uses batch (5x faster) ✅
- [ ] Batch operation logs show "batch upsert" in console
- [ ] All records cached correctly
- [ ] Batch size limit enforced (max 1000)
- [ ] Invalid record in batch → Falls back to individual

#### Batch Delete
- [ ] Delete 50+ records → Uses batch delete
- [ ] Batch delete completes successfully
- [ ] Correct count returned
- [ ] All records actually deleted

---

### 10. Sync Pipeline Tests

#### Manual Sync
- [ ] Click "Sync to Cloud" button
- [ ] Progress indicator shows sync progress
- [ ] All pending records uploaded
- [ ] Sync status updates to "Synced"
- [ ] Supabase dashboard shows updated data

#### Background Sync
- [ ] Background sync engine starts
- [ ] Polls for pending changes
- [ ] Uploads pending records automatically
- [ ] Updates sync_status after upload
- [ ] No sync conflicts

#### Sync Progress Reporting
- [ ] Progress callback fires during sync
- [ ] ETA calculation reasonable
- [ ] Success/failure counts accurate
- [ ] Summary statistics correct

---

### 11. UI/UX Tests

#### Desktop Responsiveness
- [ ] All pages render correctly on 1920x1080
- [ ] All pages render correctly on 1366x768
- [ ] All pages render correctly on 1280x720
- [ ] No horizontal scrolling
- [ ] All buttons clickable
- [ ] All forms usable

#### Error Messages
- [ ] Validation errors are clear and helpful
- [ ] Network errors show user-friendly messages
- [ ] Offline mode indicator visible
- [ ] Sync errors show retry option
- [ ] No raw error codes shown to user

#### Loading States
- [ ] Loading spinners show during data fetch
- [ ] Skeleton loaders for tables/lists
- [ ] No blank screens during load
- [ ] Timeout handling works

---

### 12. Performance Tests

#### Load Times
- [ ] App launches in < 3 seconds
- [ ] Orders page loads in < 2 seconds
- [ ] Menu page loads in < 2 seconds
- [ ] Reports page loads in < 3 seconds
- [ ] Dashboard loads in < 2 seconds

#### Sync Performance
- [ ] Initial sync (1000 records) completes in < 10 seconds
- [ ] Batch sync (100 records) completes in < 1 second
- [ ] Individual sync (10 records) completes in < 200ms

#### Memory Usage
- [ ] App uses < 500MB RAM during normal operation
- [ ] No memory leaks after extended use (2+ hours)
- [ ] Garbage collection works properly

---

## 📦 Build & Packaging

### 13. Electron Build

- [ ] Clean build directory
  ```bash
  rm -rf dist dist-electron release
  ```

- [ ] Build frontend
  ```bash
  npm run build
  ```

- [ ] Build Electron app
  ```bash
  npm run build:electron
  ```

- [ ] Build completes without errors
- [ ] No TypeScript errors in Electron build
- [ ] All assets included (icons, images)

---

### 14. Installer Testing

#### Windows Installer (NSIS)
- [ ] Installer created: `RestroFlow Setup X.X.X.exe`
- [ ] Installer size reasonable (< 150MB)
- [ ] Installer runs without errors
- [ ] Install location configurable
- [ ] Desktop shortcut created
- [ ] Start menu shortcut created
- [ ] Uninstaller works correctly
- [ ] App data cleaned up on uninstall (or preserved as designed)

#### Fresh Install Test
- [ ] Install on clean Windows machine
- [ ] App launches successfully
- [ ] First-run setup works (if applicable)
- [ ] Login/signup works
- [ ] Data downloads from Supabase

#### Update Test
- [ ] Install previous version
- [ ] Run new installer over old version
- [ ] Data preserved during update
- [ ] Settings preserved during update
- [ ] No data loss

---

### 15. Multi-Device Testing

#### Different Windows Versions
- [ ] Windows 10 (64-bit)
- [ ] Windows 11 (64-bit)
- [ ] Windows Server 2019/2022 (if applicable)

#### Different Network Configurations
- [ ] Wired Ethernet connection
- [ ] Wi-Fi connection
- [ ] LAN mode on same subnet
- [ ] LAN mode across VLANs (if applicable)

---

## 🔐 Security Checklist

### 16. Authentication & Authorization

- [ ] Supabase Auth configured correctly
- [ ] Login with email/password works
- [ ] Password reset works
- [ ] Session persistence works (stays logged in)
- [ ] Logout clears session
- [ ] Token refresh works
- [ ] Row Level Security (RLS) policies active

- [ ] Role-based access control works
  - Admin: Full access
  - Manager: Manage orders, menu, staff
  - Waiter: Create orders, view menu
  - Cashier: Process payments
  - Chef: View kitchen orders, update status
  - Host: View tables, seat customers
  - Runner: View ready orders

---

### 17. Data Security

- [ ] No sensitive data in console logs
- [ ] API keys not exposed in frontend
- [ ] Database credentials secure
- [ ] Local SQLite file permissions correct
- [ ] No SQL injection vulnerabilities
- [ ] Input validation on all forms
- [ ] XSS protection active

---

### 18. Network Security

- [ ] Supabase connection uses HTTPS
- [ ] LAN server uses HTTP (local only, acceptable)
- [ ] WebSocket connections secure
- [ ] No open ports except LAN server port
- [ ] Firewall rules documented

---

## 📝 Documentation

### 19. User Documentation

- [ ] User manual updated
- [ ] Installation guide written
- [ ] LAN setup guide written
- [ ] Troubleshooting guide written
- [ ] FAQ document updated

### 20. Developer Documentation

- [ ] README.md updated with latest features
- [ ] Architecture documentation current
- [ ] API documentation (if applicable)
- [ ] Database schema documented
- [ ] Deployment guide written

---

## 🚀 Deployment Steps

### 21. Production Deployment

#### Step 1: Final Code Push
```bash
# Ensure all changes committed
git status

# Commit final changes
git add .
git commit -m "Production release v1.0.0 - All phases complete"

# Push to main branch
git push origin main
```

#### Step 2: Build Production Executable
```bash
# Clean previous builds
rm -rf dist dist-electron release

# Install dependencies
npm install

# Build frontend
npm run build

# Build Electron installer
npm run build:electron
```

#### Step 3: Verify Build Output
```bash
# Check that installer was created
ls -lh release/

# Expected: RestroFlow Setup 1.0.0.exe
# Expected size: ~100-150MB
```

#### Step 4: Test Installer on Clean Machine
- [ ] Copy installer to clean Windows machine
- [ ] Run installer
- [ ] Complete installation
- [ ] Launch app
- [ ] Verify all features work
- [ ] Test offline mode
- [ ] Test LAN mode (if applicable)

#### Step 5: Distribute Installer
- [ ] Upload installer to distribution platform
  - Options: Google Drive, Dropbox, company server, etc.
- [ ] Generate download link
- [ ] Share link with users
- [ ] Provide installation instructions

#### Step 6: Monitor Deployment
- [ ] Monitor Supabase logs for errors
- [ ] Check for crash reports
- [ ] Monitor user feedback
- [ ] Track sync success rate
- [ ] Monitor performance metrics

---

## 📊 Post-Deployment Monitoring

### 22. Monitoring Checklist

- [ ] Supabase dashboard shows normal activity
- [ ] No increase in error rates
- [ ] Sync operations completing successfully
- [ ] No unusual database load
- [ ] No security alerts
- [ ] User feedback positive

### 23. Backup & Recovery

- [ ] Supabase database backup configured (automatic)
- [ ] Backup retention policy set (30 days recommended)
- [ ] Recovery procedure documented
- [ ] Test restore procedure (optional but recommended)

---

## 🎯 Rollback Plan

### If Issues Found After Deployment

#### Step 1: Identify Issue
- Document the problem
- Assess severity (critical, high, medium, low)
- Determine if rollback needed

#### Step 2: Rollback (if critical)
```bash
# Revert to previous version
git revert <commit-hash>

# Rebuild with previous version
npm run build:electron

# Distribute previous version installer
```

#### Step 3: Communicate
- Notify users of issue
- Provide workaround (if available)
- Share ETA for fix
- Update when resolved

---

## ✅ Final Sign-Off

### 24. Approval Checklist

- [ ] All tests passed
- [ ] No critical bugs found
- [ ] Performance acceptable
- [ ] Security review complete
- [ ] Documentation complete
- [ ] Installer tested on clean machine
- [ ] Rollback plan documented
- [ ] Team lead approval
- [ ] QA approval
- [ ] Product owner approval

---

## 📋 Quick Reference Commands

### Development
```bash
# Start development server
npm run dev

# Start Electron in dev mode
npm run electron:dev

# Type check
npm run type-check

# Lint
npm run lint
```

### Build
```bash
# Build frontend only
npm run build

# Build Electron app
npm run build:electron

# Clean build
rm -rf dist dist-electron release && npm run build:electron
```

### Database
```bash
# Apply Supabase migrations
supabase db push

# Check migration status
supabase db diff

# Create new migration
supabase db diff -f migration_name
```

### Testing
```bash
# Run tests (if applicable)
npm test

# Check for vulnerabilities
npm audit

# Update dependencies
npm update
```

---

## 📞 Support & Contact

### During Deployment
- **Lead Developer**: [Name]
- **QA Engineer**: [Name]
- **DevOps**: [Name]
- **Product Owner**: [Name]

### After Deployment
- **Support Email**: support@yourcompany.com
- **Issue Tracker**: [GitHub Issues / Jira / etc.]
- **Documentation**: [Link to docs]

---

## 🎉 Deployment Complete!

Once all checklist items are marked complete:

1. ✅ Announce release to users
2. ✅ Update version numbers
3. ✅ Tag git release
   ```bash
   git tag -a v1.0.0 -m "Production release v1.0.0"
   git push origin v1.0.0
   ```
4. ✅ Create release notes
5. ✅ Celebrate! 🎊

---

**Checklist Version**: 1.0.0  
**Last Updated**: April 14, 2026  
**Maintained By**: Development Team
