export interface Contact { id: string; name: string; email: string; phone: string; group: string; company?: string; favorite: boolean; }
export interface Settings { compact: boolean; theme: string; showPhone: boolean; }
export const GROUPS = ['Family', 'Friends', 'Work', 'Other'];
