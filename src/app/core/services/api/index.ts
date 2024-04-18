export interface IContext {
	initTime: string
	endTime: string
	executionTime: number
}

export interface IMeta {
	totalItems: number
	totalPages: number
	currentPage: number
	itemsPerPage: number
	hasMorePages: boolean
}
