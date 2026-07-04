// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Standard OpenZeppelin Contracts imports are assumed.
 * In a real build pipeline, these would be installed via npm/yarn.
 */
interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}

contract VerifyLearnSBT {
    // Metadata Details
    string public name = "VerifyLearn Credentials";
    string public symbol = "VLSBT";

    // Owner (System Gateway)
    address public owner;

    // Token ID Counter
    uint256 private _nextTokenId;

    // Mapping from token ID to owner address
    mapping(uint256 => address) private _owners;

    // Mapping owner address to token count
    mapping(address => uint256) private _balances;

    // Mapping from token ID to metadata URI
    mapping(uint256 => string) private _tokenURIs;

    // Mapping to track if a user already has a specific moduleId minted
    // userAddress => (moduleId => hasMinted)
    mapping(address => mapping(string => bool)) private _hasMintedModule;

    // Events
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event SBTMinted(address indexed recipient, uint256 indexed tokenId, string moduleId, string tokenURI);

    modifier onlyOwner() {
        require(msg.sender == owner, "VerifyLearnSBT: Caller is not the owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        _nextTokenId = 1;
    }

    /**
     * @dev Check if user has minted a specific module token.
     */
    function hasMinted(address user, string memory moduleId) public view returns (bool) {
        return _hasMintedModule[user][moduleId];
    }

    /**
     * @dev Mint a Soulbound Token (SBT) for a user on module/path completion.
     * Only the system gateway owner address can trigger this.
     */
    function mintSBT(
        address to,
        string memory moduleId,
        string memory uri
    ) external onlyOwner returns (uint256) {
        require(to != address(0), "VerifyLearnSBT: Mint to the zero address");
        require(!_hasMintedModule[to][moduleId], "VerifyLearnSBT: Token already minted for this module");

        uint256 tokenId = _nextTokenId;
        _nextTokenId++;

        _owners[tokenId] = to;
        _balances[to] += 1;
        _tokenURIs[tokenId] = uri;
        _hasMintedModule[to][moduleId] = true;

        emit Transfer(address(0), to, tokenId);
        emit SBTMinted(to, tokenId, moduleId, uri);

        return tokenId;
    }

    /**
     * @dev Get token URI metadata link.
     */
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_owners[tokenId] != address(0), "VerifyLearnSBT: URI query for nonexistent token");
        return _tokenURIs[tokenId];
    }

    /**
     * @dev Get balance of tokens owned by address.
     */
    function balanceOf(address account) external view returns (uint256) {
        require(account != address(0), "VerifyLearnSBT: Address zero is not a valid owner");
        return _balances[account];
    }

    /**
     * @dev Get owner of a specific token.
     */
    function ownerOf(uint256 tokenId) external view returns (address) {
        address tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "VerifyLearnSBT: Owner query for nonexistent token");
        return tokenOwner;
    }

    /**
     * @dev SOULBOUND LOCK: Disable standard ERC721 transfers.
     * Any transfer attempt after minting will revert, locking the token to the recipient's wallet forever.
     */
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) external pure {
        revert("VerifyLearnSBT: Soulbound tokens are non-transferable");
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId
    ) external pure {
        revert("VerifyLearnSBT: Soulbound tokens are non-transferable");
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata data
    ) external pure {
        revert("VerifyLearnSBT: Soulbound tokens are non-transferable");
    }
}
