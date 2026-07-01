// Data Validation Layer for LAN Server
// Validates all data before it enters the database

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Valid enum values for different fields
const VALID_FIELD_VALUES = {
  order_status: ['pending', 'confirmed', 'preparing', 'ready', 'served', 'completed', 'cancelled'],
  payment_status: ['pending', 'paid', 'partial', 'refunded', 'void'],
  payment_method: ['cash', 'card', 'upi', 'netbanking', 'wallet', 'split', 'complimentary'],
  food_type: ['veg', 'non-veg', 'egg', 'vegan', 'jain'],
  spice_level: ['none', 'mild', 'medium', 'hot', 'extra-hot'],
  staff_role: ['admin', 'manager', 'waiter', 'cashier', 'chef', 'host', 'runner'],
  order_item_status: ['pending', 'preparing', 'ready', 'served', 'cancelled', 'void'],
};

export class DataValidator {
  /**
   * Validate data for any table
   */
  static validate(table: string, data: Record<string, any>): void {
    switch (table) {
      case 'restaurants':
        this.validateRestaurant(data);
        break;
      case 'floors':
        this.validateFloor(data);
        break;
      case 'tables':
        this.validateTable(data);
        break;
      case 'kitchens':
        this.validateKitchen(data);
        break;
      case 'menu_categories':
        this.validateMenuCategory(data);
        break;
      case 'menu_items':
        this.validateMenuItem(data);
        break;
      case 'staff_members':
        this.validateStaffMember(data);
        break;
      case 'orders':
        this.validateOrder(data);
        break;
      case 'order_items':
        this.validateOrderItem(data);
        break;
      default:
        throw new Error(`No validator defined for table: ${table}`);
    }
  }

  /**
   * Validate restaurant data
   */
  private static validateRestaurant(data: any): void {
    this.requireField(data, 'id', 'Restaurant ID is required');
    this.requireField(data, 'name', 'Restaurant name is required');
    this.validateUUID(data.id, 'id');
    
    if (data.id && !UUID_REGEX.test(data.id)) {
      throw new Error('Invalid restaurant ID format (must be UUID)');
    }

    if (data.name && typeof data.name !== 'string') {
      throw new Error('Restaurant name must be a string');
    }

    if (data.name && data.name.length < 2) {
      throw new Error('Restaurant name must be at least 2 characters');
    }

    if (data.name && data.name.length > 200) {
      throw new Error('Restaurant name must be less than 200 characters');
    }

    if (data.phone && !this.isValidPhone(data.phone)) {
      throw new Error('Invalid phone number format');
    }

    if (data.gstin && !this.isValidGSTIN(data.gstin)) {
      throw new Error('Invalid GSTIN format');
    }

    if (data.cgst_percentage !== undefined && (typeof data.cgst_percentage !== 'number' || data.cgst_percentage < 0 || data.cgst_percentage > 100)) {
      throw new Error('CGST percentage must be a number between 0 and 100');
    }

    if (data.sgst_percentage !== undefined && (typeof data.sgst_percentage !== 'number' || data.sgst_percentage < 0 || data.sgst_percentage > 100)) {
      throw new Error('SGST percentage must be a number between 0 and 100');
    }
  }

  /**
   * Validate floor data
   */
  private static validateFloor(data: any): void {
    this.requireField(data, 'id', 'Floor ID is required');
    this.requireField(data, 'restaurant_id', 'Restaurant ID is required');
    this.requireField(data, 'name', 'Floor name is required');
    this.validateUUID(data.restaurant_id, 'restaurant_id');

    if (data.name && typeof data.name !== 'string') {
      throw new Error('Floor name must be a string');
    }

    if (data.floor_number !== undefined && !Number.isInteger(data.floor_number)) {
      throw new Error('Floor number must be an integer');
    }
  }

  /**
   * Validate table data
   */
  private static validateTable(data: any): void {
    this.requireField(data, 'id', 'Table ID is required');
    this.validateUUID(data.id, 'id');

    if (data.floor_id && !UUID_REGEX.test(data.floor_id)) {
      throw new Error('Invalid floor_id format (must be UUID)');
    }

    if (data.capacity !== undefined && (!Number.isInteger(data.capacity) || data.capacity < 1 || data.capacity > 100)) {
      throw new Error('Table capacity must be an integer between 1 and 100');
    }

    if (data.is_occupied !== undefined && typeof data.is_occupied !== 'number' || ![0, 1].includes(data.is_occupied)) {
      // Allow boolean too for convenience
      if (data.is_occupied !== undefined && typeof data.is_occupied !== 'boolean') {
        throw new Error('is_occupied must be a boolean or integer (0/1)');
      }
    }
  }

  /**
   * Validate kitchen data
   */
  private static validateKitchen(data: any): void {
    this.requireField(data, 'id', 'Kitchen ID is required');
    this.requireField(data, 'restaurant_id', 'Restaurant ID is required');
    this.requireField(data, 'name', 'Kitchen name is required');
    this.validateUUID(data.restaurant_id, 'restaurant_id');

    if (data.name && typeof data.name !== 'string') {
      throw new Error('Kitchen name must be a string');
    }

    if (data.name && data.name.length < 2) {
      throw new Error('Kitchen name must be at least 2 characters');
    }

    if (data.is_active !== undefined && typeof data.is_active !== 'number' || ![0, 1].includes(data.is_active)) {
      if (data.is_active !== undefined && typeof data.is_active !== 'boolean') {
        throw new Error('is_active must be a boolean or integer (0/1)');
      }
    }
  }

  /**
   * Validate menu category data
   */
  private static validateMenuCategory(data: any): void {
    this.requireField(data, 'id', 'Category ID is required');
    this.requireField(data, 'restaurant_id', 'Restaurant ID is required');
    this.requireField(data, 'name', 'Category name is required');
    this.validateUUID(data.restaurant_id, 'restaurant_id');

    if (data.name && typeof data.name !== 'string') {
      throw new Error('Category name must be a string');
    }

    if (data.name && data.name.length < 2) {
      throw new Error('Category name must be at least 2 characters');
    }

    if (data.sort_order !== undefined && !Number.isInteger(data.sort_order)) {
      throw new Error('Sort order must be an integer');
    }

    if (data.is_active !== undefined && typeof data.is_active !== 'number' || ![0, 1].includes(data.is_active)) {
      if (data.is_active !== undefined && typeof data.is_active !== 'boolean') {
        throw new Error('is_active must be a boolean or integer (0/1)');
      }
    }
  }

  /**
   * Validate menu item data
   */
  private static validateMenuItem(data: any): void {
    this.requireField(data, 'id', 'Menu item ID is required');
    this.requireField(data, 'category_id', 'Category ID is required');
    this.requireField(data, 'name', 'Menu item name is required');
    this.requireField(data, 'price', 'Price is required');
    this.validateUUID(data.category_id, 'category_id');

    if (data.name && typeof data.name !== 'string') {
      throw new Error('Menu item name must be a string');
    }

    if (data.name && data.name.length < 2) {
      throw new Error('Menu item name must be at least 2 characters');
    }

    if (typeof data.price !== 'number' || data.price < 0) {
      throw new Error('Price must be a non-negative number');
    }

    if (data.food_type && !VALID_FIELD_VALUES.food_type.includes(data.food_type)) {
      throw new Error(`Invalid food_type. Must be one of: ${VALID_FIELD_VALUES.food_type.join(', ')}`);
    }

    if (data.spice_level && !VALID_FIELD_VALUES.spice_level.includes(data.spice_level)) {
      throw new Error(`Invalid spice_level. Must be one of: ${VALID_FIELD_VALUES.spice_level.join(', ')}`);
    }

    if (data.preparation_time !== undefined && (!Number.isInteger(data.preparation_time) || data.preparation_time < 0)) {
      throw new Error('Preparation time must be a non-negative integer (minutes)');
    }

    if (data.is_available !== undefined && typeof data.is_available !== 'number' || ![0, 1].includes(data.is_available)) {
      if (data.is_available !== undefined && typeof data.is_available !== 'boolean') {
        throw new Error('is_available must be a boolean or integer (0/1)');
      }
    }

    if (data.kitchen_id && !UUID_REGEX.test(data.kitchen_id)) {
      throw new Error('Invalid kitchen_id format (must be UUID)');
    }
  }

  /**
   * Validate staff member data
   */
  private static validateStaffMember(data: any): void {
    this.requireField(data, 'id', 'Staff member ID is required');
    this.requireField(data, 'restaurant_id', 'Restaurant ID is required');
    this.requireField(data, 'full_name', 'Full name is required');
    this.validateUUID(data.restaurant_id, 'restaurant_id');

    if (data.full_name && typeof data.full_name !== 'string') {
      throw new Error('Full name must be a string');
    }

    if (data.full_name && data.full_name.length < 2) {
      throw new Error('Full name must be at least 2 characters');
    }

    if (data.email && !this.isValidEmail(data.email)) {
      throw new Error('Invalid email format');
    }

    if (data.phone && !this.isValidPhone(data.phone)) {
      throw new Error('Invalid phone number format');
    }

    if (data.role && !VALID_FIELD_VALUES.staff_role.includes(data.role)) {
      throw new Error(`Invalid role. Must be one of: ${VALID_FIELD_VALUES.staff_role.join(', ')}`);
    }

    if (data.is_active !== undefined && typeof data.is_active !== 'number' || ![0, 1].includes(data.is_active)) {
      if (data.is_active !== undefined && typeof data.is_active !== 'boolean') {
        throw new Error('is_active must be a boolean or integer (0/1)');
      }
    }

    if (data.user_id && !UUID_REGEX.test(data.user_id)) {
      throw new Error('Invalid user_id format (must be UUID)');
    }
  }

  /**
   * Validate order data
   */
  private static validateOrder(data: any): void {
    this.requireField(data, 'id', 'Order ID is required');
    this.requireField(data, 'restaurant_id', 'Restaurant ID is required');
    this.validateUUID(data.restaurant_id, 'restaurant_id');

    if (data.table_id && !UUID_REGEX.test(data.table_id)) {
      throw new Error('Invalid table_id format (must be UUID)');
    }

    if (data.status && !VALID_FIELD_VALUES.order_status.includes(data.status)) {
      throw new Error(`Invalid order status. Must be one of: ${VALID_FIELD_VALUES.order_status.join(', ')}`);
    }

    if (data.total_amount !== undefined && (typeof data.total_amount !== 'number' || data.total_amount < 0)) {
      throw new Error('Total amount must be a non-negative number');
    }

    if (data.cgst_amount !== undefined && (typeof data.cgst_amount !== 'number' || data.cgst_amount < 0)) {
      throw new Error('CGST amount must be a non-negative number');
    }

    if (data.sgst_amount !== undefined && (typeof data.sgst_amount !== 'number' || data.sgst_amount < 0)) {
      throw new Error('SGST amount must be a non-negative number');
    }

    if (data.discount_amount !== undefined && (typeof data.discount_amount !== 'number' || data.discount_amount < 0)) {
      throw new Error('Discount amount must be a non-negative number');
    }

    if (data.final_amount !== undefined && (typeof data.final_amount !== 'number' || data.final_amount < 0)) {
      throw new Error('Final amount must be a non-negative number');
    }

    if (data.payment_status && !VALID_FIELD_VALUES.payment_status.includes(data.payment_status)) {
      throw new Error(`Invalid payment status. Must be one of: ${VALID_FIELD_VALUES.payment_status.join(', ')}`);
    }

    if (data.payment_method && !VALID_FIELD_VALUES.payment_method.includes(data.payment_method)) {
      throw new Error(`Invalid payment method. Must be one of: ${VALID_FIELD_VALUES.payment_method.join(', ')}`);
    }

    if (data.customer_phone && !this.isValidPhone(data.customer_phone)) {
      throw new Error('Invalid customer phone number format');
    }

    if (data.customer_gstin && !this.isValidGSTIN(data.customer_gstin)) {
      throw new Error('Invalid customer GSTIN format');
    }

    if (data.created_by && !UUID_REGEX.test(data.created_by)) {
      throw new Error('Invalid created_by format (must be UUID)');
    }

    if (data.customer_name && typeof data.customer_name !== 'string') {
      throw new Error('Customer name must be a string');
    }

    if (data.notes && typeof data.notes !== 'string') {
      throw new Error('Notes must be a string');
    }
  }

  /**
   * Validate order item data
   */
  private static validateOrderItem(data: any): void {
    this.requireField(data, 'id', 'Order item ID is required');
    this.requireField(data, 'order_id', 'Order ID is required');
    this.requireField(data, 'menu_item_id', 'Menu item ID is required');
    this.requireField(data, 'quantity', 'Quantity is required');
    this.requireField(data, 'unit_price', 'Unit price is required');
    this.validateUUID(data.order_id, 'order_id');
    this.validateUUID(data.menu_item_id, 'menu_item_id');

    if (!Number.isInteger(data.quantity) || data.quantity < 1) {
      throw new Error('Quantity must be a positive integer');
    }

    if (typeof data.unit_price !== 'number' || data.unit_price < 0) {
      throw new Error('Unit price must be a non-negative number');
    }

    if (data.total_price !== undefined && (typeof data.total_price !== 'number' || data.total_price < 0)) {
      throw new Error('Total price must be a non-negative number');
    }

    if (data.status && !VALID_FIELD_VALUES.order_item_status.includes(data.status)) {
      throw new Error(`Invalid order item status. Must be one of: ${VALID_FIELD_VALUES.order_item_status.join(', ')}`);
    }

    if (data.kitchen_id && !UUID_REGEX.test(data.kitchen_id)) {
      throw new Error('Invalid kitchen_id format (must be UUID)');
    }

    if (data.special_instructions && typeof data.special_instructions !== 'string') {
      throw new Error('Special instructions must be a string');
    }
  }

  // ── Helper Methods ──────────────────────────────────────────────

  /**
   * Require a field to be present and not null/undefined
   */
  private static requireField(data: any, field: string, message: string): void {
    if (data[field] === undefined || data[field] === null) {
      throw new Error(message);
    }
  }

  /**
   * Validate UUID format
   */
  private static validateUUID(value: string, fieldName: string): void {
    if (value && !UUID_REGEX.test(value)) {
      throw new Error(`Invalid ${fieldName} format (must be UUID)`);
    }
  }

  /**
   * Validate email format
   */
  private static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate Indian phone number format
   */
  private static isValidPhone(phone: string): boolean {
    // Remove spaces, dashes, and parentheses
    const clean = phone.replace(/[\s\-\(\)]/g, '');
    // Indian phone: +91XXXXXXXXXX or 0XXXXXXXXXX or XXXXXXXXXX
    const phoneRegex = /^(\+91|0)?[6-9]\d{9}$/;
    return phoneRegex.test(clean);
  }

  /**
   * Validate Indian GSTIN format
   */
  private static isValidGSTIN(gstin: string): boolean {
    // GSTIN: 2 digits state code + 10 char PAN + 1 digit entity + 1 Z + 1 checksum
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}[Z]{1}[A-Z0-9]{1}$/;
    return gstinRegex.test(gstin.toUpperCase());
  }
}
