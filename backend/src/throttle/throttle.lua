-- Fixed-window rate-limit counter plus block flag, in one atomic step.
--
-- KEYS[1]  hit counter
-- KEYS[2]  block flag
-- ARGV[1]  window length (ms)
-- ARGV[2]  hit limit for the window
-- ARGV[3]  block duration once the limit is passed (ms)
--
-- Returns { hits, ms until the window resets, blocked (0/1), ms until the
-- block lifts }. While blocked, hits are not counted (as in @nestjs/throttler's
-- in-memory storage). When the limit is passed the counter's expiry moves to
-- the block's, so the next window starts fresh when the block lifts.

local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', hitsKey) or '0')
  local hitsTtl = redis.call('PTTL', hitsKey)
  if hitsTtl < 0 then hitsTtl = blockTtl end
  return {hits, hitsTtl, 1, blockTtl}
end

local hits = redis.call('INCR', hitsKey)
local hitsTtl = redis.call('PTTL', hitsKey)
if hitsTtl < 0 then
  redis.call('PEXPIRE', hitsKey, ttl)
  hitsTtl = ttl
end

if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', blockDuration)
  redis.call('PEXPIRE', hitsKey, blockDuration)
  return {hits, blockDuration, 1, blockDuration}
end

return { hits, hitsTtl, 0, 0 }
