-- Transition: Idle -> Cooling when temp > threshold

local THRESH = 25

function condition()
  return value("temp") ~= nil and value("temp") > THRESH
end

function body()
  -- nothing beyond switching state
end

