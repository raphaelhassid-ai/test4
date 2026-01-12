
export interface Plate {
  id: string;
  number: string;
  createdAt: number;
}

export enum AppMode {
  LIST = 'LIST',
  FLASH = 'FLASH'
}

export interface DetectionResult {
  plates: string[];
}
