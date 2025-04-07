# Audio Transcription Service with Supabase

## Project Overview
A serverless audio transcription service built on Supabase that accepts publicly accessible audio URLs, processes the audio through Google's Gemini 2.5+ API, and returns detailed transcriptions. The service includes job queuing, status tracking, and retry mechanisms.

## Core Features
- Accepts audio URLs for processing
- Asynchronous transcription processing
- Job status tracking with timing information
- Automatic retry mechanism for failed jobs
- User authentication
- RESTful API endpoints

## Technical Specifications

### Authentication
- Implemented using Supabase Auth
- Required email-based authentication
- All API endpoints require authentication

### Storage
- Supabase Storage is **not** used for the primary audio input (which is URL-based).
- The `process-job` function downloads audio directly from the provided URL.
- **Note:** Supabase Storage has a fixed file size limit per object based on the plan (e.g., 50MB), which was a reason for switching to the URL-based approach.

### Database Schema

#### Jobs Table
```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  file_path TEXT, -- No longer the primary input, made nullable
  audio_url TEXT, -- Added to store the URL of the audio file
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  state_history JSONB DEFAULT '[]',
  retry_count INTEGER DEFAULT 0,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  transcription_result JSONB,
  error_message TEXT
);
```

### API Endpoints

#### 1. Create Transcription Job
```
POST /transcribe
Authorization: Bearer <jwt>
Content-Type: application/json

Request Body: {
  "audio_url": "https://example.com/path/to/audio.mp3"
}

Response: {
  "job_id": "uuid",
  "status": "pending",
  "created_at": "timestamp"
}
```

#### 2. Get Job Status
```
GET /get-job-status/{jobId}  # Corrected endpoint name based on deploy script
Authorization: Bearer <jwt>

Response: {
  "job_id": "uuid",
  "status": "pending|processing|completed|failed",
  "created_at": "timestamp",
  "started_at": "timestamp",
  "completed_at": "timestamp",
  "transcription_result": {}, // JSON object from Gemini (when completed)
  "error_message": "error message" // if failed
}
```

#### 3. List User's Jobs
```
GET /list-jobs # Corrected endpoint name based on deploy script
Authorization: Bearer <jwt>

Response: {
  "jobs": [
    {
      // same structure as single job response
    }
  ]
}
```

### Job Processing

#### Retry Logic
- Maximum 3 retry attempts
- Exponential backoff strategy:
  1. First retry: 1 minute delay
  2. Second retry: 2 minutes delay
  3. Third retry: 5 minutes delay
- Jobs marked as permanently failed after 3 unsuccessful attempts

### Monitoring and Logging

#### Metrics Tracked
- Average processing time per job
- Failure rates and types
- Retry statistics
- API endpoint response times
- Storage usage per user

#### Logging
- Job state transitions
- Processing errors with stack traces
- Authentication failures
- API request/response logs
- Gemini API interaction logs

#### Alerts
- High failure rate detection
- Long queue processing times
- Storage capacity warnings
- Authentication anomalies

## Implementation Notes

### Supabase Setup
1. Enable Storage (Optional, see Storage section above)
2. Set up email authentication
3. Configure database with jobs table
4. Create Edge Functions for processing

### Security Considerations
- Validate input URL format (basic validation added)
- Implement rate limiting
- Set up Row Level Security (RLS) policies
- Secure API endpoints with JWT validation

### Performance Optimization
- Implement job batching if queue grows large
- (Storage patterns less relevant with URL-based input)
- Index frequently queried columns
- Cache common queries

## Testing Plan

### Unit Tests
- Input URL validation
- Job status transitions
- Retry mechanism
- Authentication flow

### Integration Tests
- End-to-end job processing
- API endpoint functionality
- Error handling and retries
- Audio download from URL

### Load Tests
- Concurrent job processing
- API endpoint performance
- Audio download speed from external URLs

## Future Enhancements (Optional)
- Webhook notifications for job completion
- Batch processing capabilities
- Advanced transcription options
- Export functionality for transcriptions 