-- Transition: Cooling -> Idle when temp <= threshold - hysteresis

local THRESH = 25
local HYST = 1

function condition()
  return value("temp") ~= nil and value("temp") <= (THRESH - HYST)
end

function body()
  -- nothing beyond switching state
end

