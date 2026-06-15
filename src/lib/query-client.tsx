import {
	QueryClient,
	QueryClientProvider,
	type QueryKey,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export const queryKeys = {
	status: ["status"] as const,
	timelines: ["timeline"] as const,
	dms: ["dms"] as const,
	linkInsights: ["link-insights"] as const,
	profileHydration: ["profile-hydration"] as const,
	networkMap: ["network-map"] as const,
};

export function createBirdclawQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				gcTime: 30 * 60_000,
				refetchOnWindowFocus: false,
				retry: 1,
				staleTime: 60_000,
			},
		},
	});
}

export function invalidateQueryFamily(
	queryClient: QueryClient,
	queryKey: QueryKey,
) {
	return queryClient.invalidateQueries({ queryKey });
}

export function BirdclawQueryProvider({ children }: { children: ReactNode }) {
	const [queryClient] = useState(createBirdclawQueryClient);
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
