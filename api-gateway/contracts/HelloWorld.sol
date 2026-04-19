pragma solidity ^0.5.0;

/**
 * S4.1 toolchain smoke — minimal contract (solc 0.5.x).
 */
contract HelloWorld {
    function sayHello() public pure returns (string memory) {
        return "Hello";
    }
}
