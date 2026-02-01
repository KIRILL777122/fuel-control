export type Driver = { 
  id: string; 
  fullName?: string | null; 
  telegramUserId: string;
  isActive?: boolean;
  isPinned?: boolean;
  lastSeenAt?: string | null;
};

export type Vehicle = { 
  id: string; 
  name: string | null; 
  plateNumber: string | null;
  isActive?: boolean;
  isPinned?: boolean;
  makeModel?: string | null;
  year?: number | null;
  vin?: string | null;
  engine?: string | null;
  color?: string | null;
  purchasedAt?: string | null;
  purchasedOdometerKm?: number | null;
  currentOdometerKm?: number | null;
  notes?: string | null;
};

export type Receipt = {
  id: string;
  driverId: string;
  vehicleId: string;
  totalAmount: string;
  status: string;
  paymentMethod: string | null;
  mileage: number | null;
  receiptAt: string;
  fuelType?: string | null;
  dataSource?: string | null;
  paidByDriver?: boolean;
  reimbursed?: boolean;
  paymentComment?: string | null;
  driver?: Driver | null;
  vehicle?: Vehicle | null;
  derivedDeltaKm?: number | null;
  derivedLPer100?: number | null;
  liters?: number | string | null;
  pricePerLiter?: number | string | null;
  addressShort?: string | null;
  stationName?: string | null;
};

export type Shift = {
  id: string;
  driverName: string;
  plateNumber: string | null;
  routeName: string;
  routeNumber?: string | null;
  plannedTime: string | null;
  assignedTime: string | null;
  departureTime?: string | null;
  delayMinutes?: number | null;
  shiftDate: string;
};

export type RouteRate = {
  id: string;
  routeName: string;
  rate: string;
};

export type DriverPayment = {
  id: string;
  driverId: string;
  amount: string;
  paymentDate: string;
  accountedDate?: string | null;
  payoutType?: string | null;
  period?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  comment?: string | null;
  driver?: Driver;
};

export type DriverPaymentDetail = {
  id: string;
  driverId: string;
  type: string;
  bankName: string | null;
  account: string;
  isDefault: boolean;
};

export type CustomList = {
  id: string;
  name: string;
  type: string;
  items: CustomListItem[];
};

export type CustomListItem = {
  id: string;
  listId: string;
  driverId?: string | null;
  vehicleId?: string | null;
  routeName?: string | null;
  driver?: Driver;
  vehicle?: Vehicle;
};

export type LateDelay = {
  id: string;
  driverName: string;
  plateNumber: string | null;
  routeName: string;
  plannedTime: string | null;
  assignedTime: string | null;
  delayMinutes: number;
  delayDate: string;
};

export type SummaryItem = {
  driverName: string;
  red: number;
  yellow: number;
  green: number;
  total: number;
  totalMinutes: number;
};
