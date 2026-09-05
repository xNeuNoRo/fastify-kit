local current = tonumber(redis.call("GET", KEYS[1]) or "0") or 0
local requested = tonumber(ARGV[1])
if current < requested then
  return redis.call("SET", KEYS[1], ARGV[1])
end
return 0
