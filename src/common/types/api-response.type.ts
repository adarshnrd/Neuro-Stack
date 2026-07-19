export class ApiResponse<T = unknown> {
  success!: boolean
  data?: T
  message?: string
  statusCode!: number
  timestamp!: string

  static ok<T>(data: T, statusCode = 200): ApiResponse<T> {
    const res = new ApiResponse<T>()
    res.success = true
    res.data = data
    res.statusCode = statusCode
    res.timestamp = new Date().toISOString()
    return res
  }

  static error(message: string, statusCode: number): ApiResponse<never> {
    const res = new ApiResponse<never>()
    res.success = false
    res.message = message
    res.statusCode = statusCode
    res.timestamp = new Date().toISOString()
    return res
  }
}
