if redis.call("GET", KEYS[1]) ~= ARGV[1] then
  return 0
end
local namespaceVersion = tonumber(redis.call("GET", KEYS[3]) or "0")
local globalVersion = tonumber(redis.call("GET", KEYS[4]) or "0")
if math.max(namespaceVersion, globalVersion) > tonumber(ARGV[4]) then
  return 0
end
if ARGV[3] == "0" then
  redis.call("SET", KEYS[2], ARGV[2])
else
  redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[3])
end
return 1
