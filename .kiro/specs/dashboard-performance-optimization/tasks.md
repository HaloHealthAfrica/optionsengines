# Implementation Plan: Dashboard Performance Optimization

## Overview

This implementation plan converts the dashboard performance optimization design into actionable coding tasks. The approach focuses on incremental delivery: first establishing the caching infrastructure, then optimizing individual endpoints, creating the aggregated endpoint, implementing cache warming, and finally adding monitoring. Each major component includes property-based tests to validate correctness properties from the design.

## Tasks

- [x] 1. Set up Redis caching infrastructure
  - Install Redis client library (ioredis for TypeScript)
  - Create CacheManager class with connection handling
  - Implement get, set, invalidate, exists, getTTL methods
  - Add configuration for TTL values by data type (GEX: 5min, analytics: 15min, performance: 10min)
  - Implement cache key building with consistent patterns
  - Add connection error handling and reconnection logic
  - _Requirements: 1.1, 1.2_

  - [x] 1.1 Write property test for cache storage with TTL
    - **Property 1: Cache Storage with TTL**
    - **Validates: Requirements 1.2, 1.5**
  
  - [x] 1.2 Write property test for cache hit behavior
    - **Property 2: Cache Hit Returns Cached Data**
    - **Validates: Requirements 1.3, 3.2, 4.2**
  
  - [x] 1.3 Write property test for cache miss behavior
    - **Property 3: Cache Miss Triggers Fresh Fetch**
    - **Validates: Requirements 1.4, 3.3**
  
  - [ ] 1.4 Write unit tests for cache connection failures
    - Test Redis unavailable scenario
    - Test reconnection with exponential backoff
    - _Requirements: 1.1_

- [-] 2. Implement GEX Service with caching
  - [x] 2.1 Create GEXService class with cache-first pattern
    - Implement getGEXData method that checks cache before external API
    - Add fetchFromExternalAPI method for cache misses
    - Implement cache key generation for GEX data
    - Add 5-minute TTL for GEX cache entries
    - Include cache metadata in responses (timestamp, TTL remaining, hit/miss)
    - _Requirements: 3.1, 3.2, 3.3, 3.5_
  
  - [x] 2.2 Add external API failure handling
    - Implement fallback to stale cached data on API failure
    - Add staleness indicator to response
    - Log external API failures with timestamps
    - _Requirements: 3.4_
  
  - [ ] 2.3 Write property test for GEX cache-first behavior
    - **Property 8: Cached Response Performance** (GEX portion)
    - **Validates: Requirements 3.1, 3.2**
  
  - [ ] 2.4 Write property test for GEX external API fallback
    - **Property 9: GEX External API Fallback**
    - **Validates: Requirements 3.4**
  
  - [ ] 2.5 Write property test for cache metadata inclusion
    - **Property 10: Cache Metadata Inclusion**
    - **Validates: Requirements 3.5**
  
  - [ ] 2.6 Write unit tests for GEX edge cases
    - Test empty GEX responses
    - Test malformed external API responses
    - Test cache expiration edge cases
    - _Requirements: 3.2, 3.3, 3.4_

- [-] 3. Implement Analytics Service with caching
  - [x] 3.1 Create AnalyticsService class with cache-first pattern
    - Implement getPnLCurve method with cache checking
    - Implement getDailyReturns method with cache checking
    - Add 15-minute TTL for analytics cache entries
    - Implement cache key generation for analytics queries
    - Include cache metadata in responses
    - _Requirements: 4.1, 4.2_
  
  - [ ] 3.2 Optimize database queries for analytics
    - Add indexes on timestamp and status columns
    - Implement query optimization for PnL curves
    - Implement query optimization for daily returns
    - Add query timeout handling
    - _Requirements: 10.1, 10.2, 10.5_
  
  - [ ] 3.3 Write property test for analytics cache behavior
    - **Property 2: Cache Hit Returns Cached Data** (analytics portion)
    - **Validates: Requirements 4.1, 4.2**
  
  - [ ] 3.4 Write property test for indexed query performance
    - **Property 22: Indexed Query Performance**
    - **Validates: Requirements 10.5**
  
  - [ ] 3.5 Write unit tests for analytics edge cases
    - Test empty date ranges
    - Test database query timeouts
    - Test invalid account IDs
    - _Requirements: 4.2_

- [ ] 4. Checkpoint - Ensure caching infrastructure works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement real-time data services (no caching)
  - [ ] 5.1 Create PositionService for real-time position data
    - Implement getOpenPositions method (direct DB query)
    - Implement getShadowPositions method (direct DB query)
    - Ensure no caching is applied
    - Add indexes on status and symbol columns
    - _Requirements: 6.1, 6.2, 10.2_
  
  - [ ] 5.2 Create SignalService for real-time signal data
    - Implement getActiveExitSignals method (direct DB query)
    - Implement getQueuedSignals method (direct DB query)
    - Implement getSourcePerformance method (with caching, 10-min TTL)
    - Ensure positions and signals are never cached
    - _Requirements: 6.3, 6.4_
  
  - [ ] 5.3 Create HealthService for system health
    - Implement getHealthStatus method (direct DB query)
    - Ensure health data is never cached
    - _Requirements: 6.5_
  
  - [ ] 5.4 Write property test for real-time data freshness
    - **Property 11: Real-Time Data Freshness**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
  
  - [ ] 5.5 Write unit tests for real-time services
    - Test position queries with various filters
    - Test signal queries with status filters
    - Test health status queries
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [-] 6. Create aggregated dashboard endpoint
  - [x] 6.1 Implement DashboardController with parallel fetching
    - Create GET /api/dashboard endpoint
    - Implement parallel data fetching using Promise.all
    - Fetch real-time data: positions, shadow positions, health, exit signals, queued signals
    - Fetch cached data: GEX, analytics, source performance
    - Aggregate all results into single response
    - _Requirements: 2.1, 2.2, 2.3_
  
  - [x] 6.2 Add partial failure handling
    - Wrap each data fetch in try-catch
    - Include error information for failed sections
    - Return HTTP 200 with partial data (not 500)
    - Log which sections failed and why
    - _Requirements: 2.4_
  
  - [x] 6.3 Add response metadata
    - Include response time in milliseconds
    - Include cache hits and misses arrays
    - Include timestamp
    - Include errors object for partial failures
    - _Requirements: 2.3_
  
  - [ ] 6.4 Write property test for parallel data fetching
    - **Property 4: Parallel Data Fetching**
    - **Validates: Requirements 2.1**
  
  - [ ] 6.5 Write property test for cache utilization
    - **Property 5: Cache Utilization in Aggregated Endpoint**
    - **Validates: Requirements 2.2**
  
  - [ ] 6.6 Write property test for complete dashboard response
    - **Property 6: Complete Dashboard Response**
    - **Validates: Requirements 2.3**
  
  - [ ] 6.7 Write property test for partial failure resilience
    - **Property 7: Partial Failure Resilience**
    - **Validates: Requirements 2.4**
  
  - [ ] 6.8 Write property test for cached response performance
    - **Property 8: Cached Response Performance**
    - **Validates: Requirements 2.5**
  
  - [ ] 6.9 Write integration tests for aggregated endpoint
    - Test full dashboard load with all data
    - Test with Redis unavailable
    - Test with external API failures
    - Test with database slow queries
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 7. Checkpoint - Ensure aggregated endpoint works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement cache warming strategy
  - [x] 8.1 Create CacheWarmer class
    - Implement warmCriticalData method for startup
    - Implement warmGEXData for critical symbols (SPY, QQQ)
    - Implement warmAnalytics for default date ranges
    - Implement warmSourcePerformance
    - Add configuration for critical symbols and warming schedule
    - _Requirements: 5.1_
  
  - [x] 8.2 Add proactive cache refresh
    - Implement scheduleProactiveRefresh method
    - Monitor TTLs and refresh before expiration
    - Use background scheduler (node-cron or similar)
    - Ensure warming doesn't block user requests
    - _Requirements: 5.2, 5.4_
  
  - [x] 8.3 Add warming failure handling
    - Implement retry logic with exponential backoff
    - Log warming failures with error details
    - Skip warming after max retries
    - Don't block system startup on warming failures
    - _Requirements: 5.5_
  
  - [ ] 8.4 Write property test for non-blocking cache warming
    - **Property 12: Cache Warmer Non-Blocking**
    - **Validates: Requirements 5.4**
  
  - [ ] 8.5 Write property test for warming retry with backoff
    - **Property 13: Cache Warming Retry with Backoff**
    - **Validates: Requirements 5.5**
  
  - [ ] 8.6 Write unit tests for cache warming
    - Test startup warming
    - Test proactive refresh
    - Test warming failures and retries
    - Test warming with Redis unavailable
    - _Requirements: 5.1, 5.2, 5.4, 5.5_

- [ ] 9. Implement cache invalidation strategy
  - [x] 9.1 Create cache invalidation triggers
    - Add invalidation on position updates (invalidate analytics)
    - Add invalidation on signal updates (invalidate source performance)
    - Implement targeted invalidation by pattern
    - Ensure only matching keys are removed
    - _Requirements: 9.1, 9.2, 9.3_
  
  - [x] 9.2 Add administrative cache clearing endpoint
    - Create POST /api/admin/cache/clear endpoint
    - Support clearing by pattern or all cache
    - Add authentication/authorization
    - Log manual cache clears
    - _Requirements: 9.4_
  
  - [x] 9.3 Add invalidation failure handling
    - Log invalidation errors
    - Fall back to TTL-based expiration
    - Don't fail requests on invalidation errors
    - _Requirements: 9.5_
  
  - [ ] 9.4 Write property test for cache invalidation on data changes
    - **Property 18: Cache Invalidation on Data Changes**
    - **Validates: Requirements 9.1, 9.2**
  
  - [ ] 9.5 Write property test for targeted cache invalidation
    - **Property 19: Targeted Cache Invalidation**
    - **Validates: Requirements 9.3**
  
  - [ ] 9.6 Write property test for invalidation fallback
    - **Property 20: Cache Invalidation Fallback**
    - **Validates: Requirements 9.5**
  
  - [ ] 9.7 Write unit tests for cache invalidation
    - Test invalidation on position updates
    - Test invalidation on signal updates
    - Test admin endpoint
    - Test invalidation failures
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [-] 10. Implement response time monitoring
  - [x] 10.1 Create ResponseMonitor middleware
    - Implement middleware function for Express/Fastify
    - Record start time on request
    - Calculate response time on completion
    - Log response time with endpoint details
    - Include cache hit/miss information in logs
    - _Requirements: 7.1, 7.2, 7.4_
  
  - [x] 10.2 Add slow request alerting
    - Log warnings for requests > 1 second
    - Include endpoint, response time, cache metrics
    - Add structured logging for monitoring tools
    - _Requirements: 7.3_
  
  - [x] 10.3 Implement metrics export
    - Calculate avg response time, p95, p99
    - Calculate cache hit rate
    - Count slow requests (> 1 second)
    - Expose metrics endpoint (GET /api/metrics)
    - Format for Prometheus/Grafana or similar
    - _Requirements: 7.5_
  
  - [ ] 10.4 Write property test for response time monitoring
    - **Property 14: Response Time Monitoring**
    - **Validates: Requirements 7.1, 7.2, 7.4**
  
  - [ ] 10.5 Write property test for slow request alerting
    - **Property 15: Slow Request Alerting**
    - **Validates: Requirements 7.3**
  
  - [ ] 10.6 Write property test for metrics export
    - **Property 16: Metrics Export**
    - **Validates: Requirements 7.5**
  
  - [ ] 10.7 Write unit tests for monitoring
    - Test middleware integration
    - Test slow request logging
    - Test metrics calculation
    - Test metrics endpoint
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 11. Add slow query logging
  - [x] 11.1 Implement database query monitoring
    - Add query timing wrapper
    - Log queries exceeding threshold (500ms)
    - Include query details and execution time
    - Add structured logging for analysis
    - _Requirements: 10.4_
  
  - [ ] 11.2 Write property test for slow query logging
    - **Property 21: Slow Query Logging**
    - **Validates: Requirements 10.4**
  
  - [ ] 11.3 Write unit tests for query monitoring
    - Test slow query detection
    - Test query logging format
    - Test threshold configuration
    - _Requirements: 10.4_

- [ ] 12. Ensure backward compatibility
  - [ ] 12.1 Apply caching to existing individual endpoints
    - Update /positions endpoint with caching (no cache - real-time)
    - Update /shadow-positions endpoint (no cache - real-time)
    - Update /health endpoint (no cache - real-time)
    - Update /exit-signals endpoint (no cache - real-time)
    - Update /signals endpoint (no cache - real-time)
    - Update /signals/sources/performance endpoint (10-min cache)
    - Update /positioning/gex endpoint (5-min cache)
    - Update /analytics/pnl-curve endpoint (15-min cache)
    - Update /analytics/daily-returns endpoint (15-min cache)
    - Ensure response formats remain unchanged
    - _Requirements: 8.1, 8.2, 8.4_
  
  - [ ] 12.2 Write property test for backward compatible response format
    - **Property 17: Backward Compatible Response Format**
    - **Validates: Requirements 8.1, 8.2, 8.4**
  
  - [ ] 12.3 Write integration tests for backward compatibility
    - Test all 9 individual endpoints
    - Compare response formats before/after caching
    - Verify clients continue to work
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 13. Final checkpoint - End-to-end testing
  - [ ] 13.1 Run full test suite
    - Execute all unit tests
    - Execute all property-based tests (100+ iterations each)
    - Execute all integration tests
    - Verify all tests pass
  
  - [ ] 13.2 Performance validation
    - Measure dashboard load time with cold cache
    - Measure dashboard load time with warm cache
    - Verify < 1 second response time for cached requests
    - Verify cache hit rates > 80%
    - _Requirements: 2.5_
  
  - [ ] 13.3 Error scenario testing
    - Test with Redis unavailable
    - Test with external GEX API down
    - Test with database slow queries
    - Verify graceful degradation
    - Verify error handling and logging
  
  - [ ] 13.4 Final review and documentation
    - Ensure all tests pass
    - Review monitoring dashboards
    - Document configuration options
    - Document deployment steps
    - Ask the user if questions arise

## Notes

- All tasks are required for comprehensive implementation with full test coverage
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design
- Unit tests validate specific examples, edge cases, and error conditions
- Checkpoints ensure incremental validation at major milestones
- Implementation uses TypeScript with Node.js backend
- Redis is used for caching layer
- Property-based testing uses fast-check library (minimum 100 iterations per test)
- Each property test is tagged with: `Feature: dashboard-performance-optimization, Property {N}: {property_text}`
