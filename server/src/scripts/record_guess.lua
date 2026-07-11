-- KEYS[1] = solved set key for this round (e.g., "room:ABCD:solved")
-- ARGV[1] = playerId
-- ARGV[2] = timeElapsed (used as the score for sorting)
-- ARGV[3] = totalPlayers we are waiting for

-- Step 1: Try to add the player. 'NX' ensures they are only added if they don't already exist.
local added = redis.call('ZADD', KEYS[1], 'NX', ARGV[2], ARGV[1])

if added == 0 then
    -- They already guessed correctly previously, do not double-score them.
    -- Return: [wasNewGuess=false, isRoundOver=false]
    return {0, 0}
end

-- Step 2 & 3: They were successfully added. Now check if the round is over.
local solvedCount = redis.call('ZCARD', KEYS[1])
local totalPlayers = tonumber(ARGV[3])
local allGuessed = 0

-- Check if this final guess pushed the count to the total we need
if solvedCount >= totalPlayers then
    allGuessed = 1
end

-- Return: [wasNewGuess=true, isRoundOver=allGuessed]
return {1, allGuessed}
