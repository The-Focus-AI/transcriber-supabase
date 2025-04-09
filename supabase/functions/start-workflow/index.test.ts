import { assertEquals, assertExists } from 'https://deno.land/std@0.177.0/testing/asserts.ts'
import { handleRequest } from './index.ts' // Import the handler function
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2' // To mock createSupabaseClient

// Define interfaces for mock structure to improve type safety
interface MockSupabase {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null }; error: Error | null }>
  };
  from: (table: string) => MockTable;
}

interface MockTable {
  select: (columns?: string) => MockQuery;
  insert: (data: any) => MockQuery;
}

interface MockQuery {
  eq?: (column: string, value: any) => MockQuery;
  maybeSingle?: () => Promise<{ data: any; error: Error | null }>;
  single?: () => Promise<{ data: any; error: Error | null }>;
}

// --- Mock Supabase Client --- 
// Use a function to create a fresh mock for each test context if needed,
// or reset properties carefully.
const createDefaultMockSupabase = (): MockSupabase => ({
  auth: {
    // Default successful auth
    getUser: () => Promise.resolve({ data: { user: { id: 'test-user-id' } }, error: null }),
  },
  from: (table: string): MockTable => {
    if (table === 'workflows') {
      return {
        select: () => ({
          eq: () => ({
            // Default workflow found
            maybeSingle: () => Promise.resolve({ data: { id: 'valid-workflow-id' }, error: null }),
          }),
        }),
        // Add dummy insert/single for type compatibility if needed by MockTable interface
        insert: () => ({}), 
      } as MockTable
    }
    if (table === 'jobs') {
      return {
        insert: (jobData: any) => ({
          select: () => ({
            // Default successful insert
            single: () => Promise.resolve({
              data: {
                id: 'new-job-123',
                status: 'pending',
                created_at: new Date().toISOString(),
                ...jobData,
              },
              error: null,
            }),
          }),
        }),
        // Add dummy select/eq/maybeSingle for type compatibility
        select: () => ({}), 
      } as MockTable
    }
    // Default fallback for unhandled tables
    console.warn(`MockSupabase: Unhandled table requested: ${table}`);
    return {
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: new Error(`Unexpected table: ${table}`) }) }) }),
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: new Error(`Unexpected table: ${table}`) }) }) })
    } as MockTable
  },
})

// --- Test Suite --- 
Deno.test('start-workflow tests', async (t) => {
  // Create the mock instance
  let mockSupabaseInstance = createDefaultMockSupabase();

  // --- Individual Test Steps --- 

  await t.step('OPTIONS request returns ok', async () => {
    const req = new Request('http://localhost/workflows/start', { method: 'OPTIONS' });
    const res = await handleRequest(req, {} as SupabaseClient);
    assertEquals(res.status, 200);
    assertEquals(await res.text(), 'ok');
  });

  await t.step('POST without auth returns 401', async () => {
    mockSupabaseInstance = createDefaultMockSupabase();
    const originalGetUser = mockSupabaseInstance.auth.getUser;
    mockSupabaseInstance.auth.getUser = () => Promise.resolve({ data: { user: null }, error: new Error('Auth error') });

    const req = new Request('http://localhost/workflows/start', {
      method: 'POST',
      body: JSON.stringify({ workflow_id: 'test' }),
      headers: { 'Content-Type': 'application/json' }
    });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, 'Authentication failed');

    mockSupabaseInstance.auth.getUser = originalGetUser;
  });

  await t.step('POST with missing body returns 400', async () => {
    mockSupabaseInstance = createDefaultMockSupabase();
    const req = new Request('http://localhost/workflows/start', { method: 'POST', headers: { 'Authorization': 'Bearer test' } });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, 'Missing request body');
  });

  await t.step('POST with empty body returns 400', async () => {
    mockSupabaseInstance = createDefaultMockSupabase();
    const req = new Request('http://localhost/workflows/start', {
      method: 'POST',
      body: '',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test', 'Content-Length': '0'}
     });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, 'Empty request body');
  });

  await t.step('POST with invalid JSON returns 400', async () => {
    mockSupabaseInstance = createDefaultMockSupabase();
    const req = new Request('http://localhost/workflows/start', {
      method: 'POST',
      body: '{invalid json',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' }
    });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, 'Invalid JSON in request body');
  });

  await t.step('POST with missing workflow_id returns 400', async () => {
    mockSupabaseInstance = createDefaultMockSupabase();
    const req = new Request('http://localhost/workflows/start', {
      method: 'POST',
      body: JSON.stringify({ input_data: { key: 'value' } }),
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' }
    });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, 'Missing workflow_id in request body');
  });

  await t.step('POST with non-existent workflow_id returns 404', async () => {
    mockSupabaseInstance = createDefaultMockSupabase();
    const originalFrom = mockSupabaseInstance.from;
    mockSupabaseInstance.from = (table: string) => {
      if (table === 'workflows') {
        return {
          ...createDefaultMockSupabase().from(table),
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) })
        } as MockTable;
      }
      return originalFrom(table);
    };

    const req = new Request('http://localhost/workflows/start', {
      method: 'POST',
      body: JSON.stringify({ workflow_id: 'invalid-id' }),
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' }
    });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 404);
    assertEquals((await res.json()).error, "Workflow with id 'invalid-id' not found");

    mockSupabaseInstance.from = originalFrom;
  });


  await t.step('Successful POST creates job and returns 201', async () => {
    mockSupabaseInstance = createDefaultMockSupabase();
    const input = { key: 'data' };
    const req = new Request('http://localhost/workflows/start', {
      method: 'POST',
      body: JSON.stringify({ workflow_id: 'valid-workflow-id', input_data: input }),
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' }
    });
    const res = await handleRequest(req, mockSupabaseInstance as any);
    assertEquals(res.status, 201);
    const body = await res.json();
    assertExists(body.id);
    assertEquals(body.id, 'new-job-123');
    assertEquals(body.status, 'pending');
    assertExists(body.created_at);
    assertEquals(body.user_id, 'test-user-id');
    assertEquals(body.workflow_id, 'valid-workflow-id');
    assertEquals(body.input_data, input);
  });

  await t.step('POST fails with 500 on job insert error', async () => {
    mockSupabaseInstance = createDefaultMockSupabase();
    const originalFrom = mockSupabaseInstance.from;
    mockSupabaseInstance.from = (table: string) => {
      if (table === 'jobs') {
         return {
           ...createDefaultMockSupabase().from(table),
           insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: new Error('Insert failed') }) }) })
         } as MockTable;
      }
      return originalFrom(table);
    };

    const input = { key: 'data' };
    const req = new Request('http://localhost/workflows/start', {
      method: 'POST',
      body: JSON.stringify({ workflow_id: 'valid-workflow-id', input_data: input }),
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' }
    });
     const res = await handleRequest(req, mockSupabaseInstance as any);
     assertEquals(res.status, 500);
     assertEquals((await res.json()).error, 'Failed to create job');

     mockSupabaseInstance.from = originalFrom;
  });
}); 