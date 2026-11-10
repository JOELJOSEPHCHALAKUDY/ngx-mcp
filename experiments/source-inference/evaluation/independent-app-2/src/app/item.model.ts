export interface Item {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  category: string;
  perishable: boolean;
  archived: boolean;
}

export type ItemInput = Omit<Item, 'id' | 'archived'> & { archived?: boolean };
