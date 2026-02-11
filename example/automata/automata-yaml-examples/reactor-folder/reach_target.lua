function condition()
  return value("core_temp") >= value("target_temp")
end

function body()
  log("info", "transition reach_target")
end
