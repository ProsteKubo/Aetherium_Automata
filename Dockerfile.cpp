FROM ubuntu:22.04

# Install build dependencies (cmake from Kitware PPA to satisfy >= 3.26 requirement)
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    libssl-dev \
    zlib1g-dev \
    wget \
    ca-certificates \
    gpg \
    && wget -qO- https://apt.kitware.com/keys/kitware-archive-latest.asc \
       | gpg --dearmor - > /usr/share/keyrings/kitware-archive-keyring.gpg \
    && echo 'deb [signed-by=/usr/share/keyrings/kitware-archive-keyring.gpg] https://apt.kitware.com/ubuntu/ jammy main' \
       > /etc/apt/sources.list.d/kitware.list \
    && apt-get update && apt-get install -y cmake \
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
