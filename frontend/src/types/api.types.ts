export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  message?: string
  statusCode: number
  timestamp: string
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  totalPages: number
}

export interface ApiError {
  statusCode: number
  message: string
  error?: string
}
