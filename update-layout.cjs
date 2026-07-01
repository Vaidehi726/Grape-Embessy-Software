const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/pages/dashboard/OrderKiosk.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Find the start of the main layout section
const layoutStart = '      <div className="flex-1 flex overflow-hidden min-w-0">\n          {/* Left Side - Tables / Menu */}\n          <div className="flex-1 flex flex-col overflow-hidden min-w-0">\n          {!selectedTable ? (';

// Find where the Cart section ends (before Billing Dialog)
const layoutEnd = '      {/* Billing Dialog */}';

const startIndex = content.indexOf(layoutStart);
const endIndex = content.indexOf(layoutEnd);

if (startIndex === -1 || endIndex === -1) {
  console.error('Could not find layout boundaries');
  console.log('Start found:', startIndex !== -1);
  console.log('End found:', endIndex !== -1);
  process.exit(1);
}

console.log('Found layout section from line', content.substring(0, startIndex).split('\n').length, 'to', content.substring(0, endIndex).split('\n').length);

// New layout structure
const newLayout = `      <div className="flex-1 flex overflow-hidden min-w-0">
        {/* Left Panel - Always-visible Compact Table List */}
        <div className="w-[200px] lg:w-[240px] border-r bg-card flex flex-col overflow-hidden shrink-0">
          {/* Header with search */}
          <div className="p-3 border-b">
            <h3 className="font-semibold mb-2 text-sm">Tables</h3>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input 
                placeholder="Search..." 
                value={tableSearchQuery}
                onChange={(e) => setTableSearchQuery(e.target.value)}
                className="h-7 text-xs pl-7"
              />
            </div>
          </div>
          
          {/* Scrollable table list */}
          <ScrollArea className="flex-1">
            {floors
              .filter(f => !tableSearchQuery || 
                f.name.toLowerCase().includes(tableSearchQuery.toLowerCase()) || 
                f.tables.some(t => t.table_number.toLowerCase().includes(tableSearchQuery.toLowerCase())))
              .map(floor => {
                const filteredTables = floor.tables
                  .filter(t => !tableSearchQuery || t.table_number.toLowerCase().includes(tableSearchQuery.toLowerCase()))
                  .sort((a, b) => {
                    if (a.is_occupied !== b.is_occupied) return a.is_occupied ? -1 : 1;
                    return a.table_number.localeCompare(b.table_number);
                  });
                
                if (filteredTables.length === 0) return null;
                
                return (
                  <div key={floor.id} className="p-2">
                    <h4 className="text-[10px] font-medium text-muted-foreground px-1 py-1 uppercase tracking-wider">
                      {floor.name}
                    </h4>
                    <div className="grid grid-cols-3 gap-1">
                      {filteredTables.map(table => (
                        <button
                          key={table.id}
                          onClick={() => handleTableClick(table)}
                          className={cn(
                            "p-1.5 rounded text-center text-xs transition-all border",
                            selectedTable?.id === table.id 
                              ? "bg-primary text-primary-foreground border-primary ring-1 ring-primary"
                              : table.is_occupied 
                                ? "bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20"
                                : "bg-success/10 text-success border-success/30 hover:bg-success/20"
                          )}
                        >
                          <div className="font-semibold leading-tight">{table.table_number}</div>
                          <div className="text-[8px] opacity-70 mt-0.5">
                            {table.is_occupied ? 'Occ' : 'Free'}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
          </ScrollArea>
        </div>

        {/* Right Panel - Menu + Cart */}
        <div className="flex-1 flex overflow-hidden min-w-0">
          {!selectedTable ? (
            // Empty state when no table selected
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Users className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-xl font-medium">Select a table</p>
                <p className="text-sm mt-2">Choose a table from the left to start taking orders</p>
              </div>
            </div>
          ) : (
            // Menu + Cart View
            <>
              {/* Menu Section */}
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                {/* Search & Categories */}
                <div className="p-4 border-b space-y-3 shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search menu..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <div className="w-full overflow-x-auto">
                    <div className="flex gap-2 pb-1 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant={selectedCategoryId === 'all' ? 'default' : 'outline'}
                        onClick={() => setSelectedCategoryId('all')}
                        className="shrink-0"
                      >
                        All
                      </Button>
                      {categories.map((cat) => (
                        <Button
                          key={cat.id}
                          size="sm"
                          variant={selectedCategoryId === cat.id ? 'default' : 'outline'}
                          onClick={() => setSelectedCategoryId(cat.id)}
                          className="shrink-0"
                        >
                          {cat.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Menu Items Grid */}
                <ScrollArea className="flex-1 p-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-w-full">
                    {filteredMenuItems.map((item) => {
                      const existingItem = cart.find(c => c.menuItem.id === item.id && c.status);
                      const newItem = cart.find(c => c.menuItem.id === item.id && !c.status);
                      
                      return (
                        <Card 
                          key={item.id} 
                          className={\`cursor-pointer transition-all hover:shadow-md \${
                            newItem ? 'ring-2 ring-primary' : existingItem ? 'ring-1 ring-muted-foreground' : ''
                          }\`}
                          onClick={() => addToCart(item)}
                        >
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <FoodTypeIndicator type={item.food_type} />
                              <SpiceLevelIndicator level={item.spice_level} />
                            </div>
                            <h3 className="font-semibold mt-2 line-clamp-2 text-sm">{item.name}</h3>
                            {item.description && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {item.description}
                              </p>
                            )}
                            <div className="flex items-center justify-between mt-3">
                              <span className="font-bold text-primary">₹{item.price}</span>
                              <div className="flex items-center gap-1">
                                {existingItem && (
                                  <Badge variant="outline" className="text-xs border-muted-foreground text-muted-foreground">
                                    x{existingItem.quantity}
                                  </Badge>
                                )}
                                {newItem && (
                                  <Badge variant="default" className="text-xs">
                                    +{newItem.quantity}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>

              {/* Cart Section - Always visible when table selected */}
              <div className="w-[320px] lg:w-[360px] border-l bg-card flex flex-col overflow-hidden shrink-0">
                <div className="p-3 border-b flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4" />
                    <span className="font-semibold text-sm">Order</span>
                    <Badge variant="outline" className="text-xs">
                      {selectedTable.table_number}
                    </Badge>
                  </div>
                  <Button size="icon" variant="ghost" onClick={handleCloseOrder} className="h-7 w-7">
                    <X className="w-3 h-3" />
                  </Button>
                </div>

                <ScrollArea className="flex-1 p-3">
                  {/* Existing Order Items */}
                  {activeOrder && activeOrder.items.length > 0 && (
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Receipt className="w-3 h-3" />
                        <span className="text-xs font-medium">Running Order</span>
                      </div>
                      <div className="space-y-2">
                        {cart.filter(item => item.status && item.status !== 'cancelled').map((item) => {
                          const isPending = item.status === 'pending';
                          const isCooking = item.status === 'cooking';
                          
                          return (
                            <div key={\`\${item.menuItem.id}-\${item.status}\`} className="flex items-center gap-2 bg-muted/30 border border-border/50 rounded-lg p-2 text-sm">
                              <div className="flex-1 min-w-0">
                                <Badge 
                                  variant="outline" 
                                  className={\`text-xs mb-1 \${
                                    item.status === 'ready' 
                                      ? 'border-success text-success bg-success/10' 
                                      : item.status === 'cooking'
                                      ? 'border-warning text-warning bg-warning/10'
                                      : 'border-muted-foreground'
                                  }\`}
                                >
                                  {item.status}
                                </Badge>
                                <p className="font-medium truncate">{item.menuItem.name}</p>
                              </div>
                              <span className="font-medium">x{item.quantity}</span>
                              <span className="font-medium w-12 text-right">₹{item.menuItem.price * item.quantity}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* New Items */}
                  {cart.filter(item => !item.status).length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Plus className="w-3 h-3" />
                        <span className="text-xs font-medium text-primary">New Items</span>
                      </div>
                      <div className="space-y-2">
                        {cart.filter(item => !item.status).map((item) => (
                          <div key={item.menuItem.id} className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg p-2 text-sm">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{item.menuItem.name}</p>
                              <p className="text-xs text-muted-foreground">₹{item.menuItem.price} each</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-6 w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateQuantity(item.menuItem.id, -1);
                                }}
                              >
                                <Minus className="w-3 h-3" />
                              </Button>
                              <span className="w-4 text-center font-medium">{item.quantity}</span>
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-6 w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateQuantity(item.menuItem.id, 1);
                                }}
                              >
                                <Plus className="w-3 h-3" />
                              </Button>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromCart(item.menuItem.id);
                              }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {cart.length === 0 && (
                    <div className="text-center text-muted-foreground py-8">
                      <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">Cart is empty</p>
                      <p className="text-xs mt-1">Click menu items to add</p>
                    </div>
                  )}
                </ScrollArea>

                {/* Cart Footer */}
                <div className="p-3 border-t space-y-2 shrink-0">
                  {cart.filter(item => !item.status).length > 0 && (
                    <>
                      <div className="flex justify-between text-sm font-bold">
                        <span>New Items Total</span>
                        <span>₹{cart.filter(item => !item.status).reduce((sum, item) => sum + item.menuItem.price * item.quantity, 0)}</span>
                      </div>
                      <Button 
                        className="w-full" 
                        size="sm"
                        onClick={submitOrder}
                        disabled={submitting}
                      >
                        <Send className="w-4 h-4 mr-2" />
                        {submitting ? 'Sending...' : 'Send to Kitchen'}
                      </Button>
                    </>
                  )}
                  {activeOrder && activeOrder.items.length > 0 && (
                    <Button 
                      className="w-full bg-success hover:bg-success/90"
                      size="sm"
                      onClick={() => setShowBillDialog(true)}
                    >
                      <CreditCard className="w-4 h-4 mr-2" />
                      Generate Bill
                    </Button>
                  )}
                  <Button 
                    variant="outline" 
                    className="w-full"
                    size="sm"
                    onClick={markTableFree}
                  >
                    Mark Table Available
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

`;

// Replace the old layout with the new one
const newContent = content.substring(0, startIndex) + newLayout + content.substring(endIndex);

fs.writeFileSync(filePath, newContent);
console.log('Layout updated successfully!');
