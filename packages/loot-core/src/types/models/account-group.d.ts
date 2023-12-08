export interface AccountGroupEntity {
  id?: string;
  name: string;
  sort_order?: number;
  tombstone?: boolean;
  accounts?: AccountEntity[];
}
