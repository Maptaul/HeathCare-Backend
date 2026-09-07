export interface IQuery {
  searchTerm?: string;
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: string;
  // any other query parameters can be added here
  [key: string]: any;
}
