export function createMockSupabaseClient(mockResponses: any): any {
    return {
        from: () => ({
            select: () => ({
                eq: () => ({
                    neq: () => ({
                        order: () => ({
                            limit: () => mockResponses
                        })
                    }),
                    maybeSingle: () => mockResponses
                })
            })
        }),
        functions: {
            invoke: () => mockResponses.functions.invoke
        }
    };
} 