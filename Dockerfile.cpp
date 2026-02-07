FROM ubuntu:22.04

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    libssl-dev \
    zlib1g-dev \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy all source files needed for build
COPY CMakeLists.txt /app/
COPY src/ /app/src/
COPY example/ /app/example/

# Build the engine
RUN mkdir -p build && cd build && \
    cmake .. && \
    make -j$(nproc)

# Set entrypoint
WORKDIR /app/build
ENTRYPOINT ["./aetherium_engine"]
