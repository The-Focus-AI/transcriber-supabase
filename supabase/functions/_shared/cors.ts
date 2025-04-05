// Allow requests from anywhere. For specific origins, replace '*' with your frontend URL.
// e.g., 'https://your-frontend-app.com'
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};