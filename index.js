const { PublicKey, Keypair, SystemProgram, Transaction, Connection, clusterApiUrl } = require("@solana/web3.js");
const {
    AccountLayout,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    AuthorityType,
    MintLayout,
    Token,
    TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");
const {
    PROGRAM_ID: TOKEN_METADATA_PROGRAM_ID,
    createCreateMetadataAccountV2Instruction,
    UseMethod,
    CollectionAuthorityRecord,
    createCreateMasterEditionInstruction,
    createSignMetadataInstruction,
    createVerifyCollectionInstruction,
    createCreateMasterEditionV3Instruction
} = require("@metaplex-foundation/mpl-token-metadata");

const loadKeyPairFromFs = (path) =>
    Keypair.fromSecretKey(
        Buffer.from(
            JSON.parse(
                require("fs").readFileSync(path, {
                    encoding: "utf-8",
                }),
            ),
        ),
    );


const run = async () => {
    const connection = new Connection(clusterApiUrl("devnet"));
    const adminKeypair = loadKeyPairFromFs("dev_keys/admin.json");
    const collectionAuthorityKeypair = loadKeyPairFromFs("dev_keys/collection-authority.json");
    const recipientKeypair = loadKeyPairFromFs("dev_keys/recipient.json");
    const tx1 = new Transaction();
    const collectionNFTMintKeypair = Keypair.generate();

    // we need to create a fresh account with enough space to store
    // a mint.
    const createAccountInstruction = SystemProgram.createAccount({
        fromPubkey: adminKeypair.publicKey,
        newAccountPubkey: collectionNFTMintKeypair.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(MintLayout.span),
        space: MintLayout.span,
        programId: TOKEN_PROGRAM_ID
    });

    // we take the fresh account and call the initialize mint method on the 
    // spl token program to set up the mint.
    const intializeCollectionMintInstruction = Token.createInitMintInstruction(
        TOKEN_PROGRAM_ID,
        collectionNFTMintKeypair.publicKey,
        0,
        adminKeypair.publicKey,
        adminKeypair.publicKey
    );

    // before we can make a Metaplex metadata account, we need to find its address.
    const collectionNFTMetadataAddress = PublicKey.findProgramAddressSync([
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        collectionNFTMintKeypair.publicKey.toBuffer(),
    ], TOKEN_METADATA_PROGRAM_ID);


    // here we call the createMetadataAccountV2 method on the Token Metadata Program (Metaplex).
    const createCollectionNFTInstruction = createCreateMetadataAccountV2Instruction({
        metadata: collectionNFTMetadataAddress[0],
        mint: collectionNFTMintKeypair.publicKey,
        mintAuthority: adminKeypair.publicKey,
        payer: adminKeypair.publicKey,
        updateAuthority: adminKeypair.publicKey,
    }, {
        createMetadataAccountArgsV2: {
            data: {
                name: "Test From Devland",
                symbol: "DEVLAND",
                uri: "https://api.jsonbin.io/b/627e726138be29676103f1ae/1",
                sellerFeeBasisPoints: 0,
                creators: [{
                    address: adminKeypair.publicKey,
                    share: 100,
                    verified: false,
                }],
                collection: null,
                uses: {
                    useMethod: UseMethod.Burn,
                    remaining: 0,
                    total: 0,
                },
            },
            isMutable: true,
        },
    });

    // All SPL tokens are held in associated token accounts. Before we can create an associated token
    // account, we need to find its adddress.
    const adminAssociatedTokenAccountAddress = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        collectionNFTMintKeypair.publicKey,
        adminKeypair.publicKey,
        false
    );

    // Here we make an associated token account for our project "admin"
    // or the account that actually goes through and creates the NFTS.
    const createAdminAssociatedTokenAccountInstruction = Token.createAssociatedTokenAccountInstruction(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        collectionNFTMintKeypair.publicKey,
        adminAssociatedTokenAccountAddress,
        adminKeypair.publicKey,
        adminKeypair.publicKey
    );

    const mintAnNFTInstruction = Token.createMintToInstruction(
        TOKEN_PROGRAM_ID,
        collectionNFTMintKeypair.publicKey,
        adminAssociatedTokenAccountAddress,
        adminKeypair.publicKey,
        [],
        1
    );

    const disableMintingInstruction = Token.createSetAuthorityInstruction(
        TOKEN_PROGRAM_ID,
        collectionNFTMintKeypair.publicKey,
        null,
        "MintTokens",
        adminKeypair.publicKey,
        []
    );

    // we do this to verify creators after minting.
    const signMetadataInstruction = createSignMetadataInstruction({
        metadata: collectionNFTMetadataAddress[0],
        creator: adminKeypair.publicKey
    });

    const collectionNFTMasterEditionAddress = PublicKey.findProgramAddressSync([
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        collectionNFTMintKeypair.publicKey.toBuffer(),
        Buffer.from("edition"),
    ], TOKEN_METADATA_PROGRAM_ID);

    const createCollectionMasterEditionInstruction = createCreateMasterEditionInstruction({
        edition: collectionNFTMasterEditionAddress[0],
        mint: collectionNFTMintKeypair.publicKey,
        mintAuthority: adminKeypair.publicKey,
        updateAuthority: adminKeypair.publicKey,
        payer: adminKeypair.publicKey,
        metadata: collectionNFTMetadataAddress[0]
    }
        , {
            createMasterEditionArgs: {
                maxSupply: 0
            }
        }
    );

    // these are the basic instructions you need to include to:
    // 1. create a fresh account
    // 2. initialize the account as a token mint
    // 3. create a metadata account
    // 4. create an associated token account for the creator of the collection
    // 5. mint an nft to the creator's associated token account
    // 6. disable future minting of tokens from the mint
    // 7. verify the NFT
    // 8. make a master edition record
    tx1.add(createAccountInstruction)
        .add(intializeCollectionMintInstruction)
        .add(createCollectionNFTInstruction)
        .add(createAdminAssociatedTokenAccountInstruction)
        .add(mintAnNFTInstruction)
        .add(signMetadataInstruction)
        .add(createCollectionMasterEditionInstruction);

    try {
        // we have to sign the transaction with our newly created collectionNFTMintKeypair to prove we own
        // it.
        const tx1Signature = await connection.sendTransaction(tx1, [adminKeypair, collectionNFTMintKeypair]);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        const confirmation = await connection.confirmTransaction({ signature: tx1Signature, blockhash, lastValidBlockHeight });

        // fail immediately if there is some error from Solana.
        // errors are usually caught in the transaction simulation.
        // transaction simulations are turned on by default but they can be disabled in the "send transaction config".
        if (confirmation.value.err) {
            console.error(confirmation.value.err.toString());
            process.exit(1);
        }

        console.log("sent and confirmed transaction: ", tx1Signature);

    } catch (e) {
        // this is here to show us the logs from the transaction simulation.
        // NOTE: they will be swallowed by the promise machinery if we don't manually log them here.
        console.error(e);
        process.exit(1);
    }

    const currentCollectionAuthorityRecordAddress = PublicKey.findProgramAddressSync([
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        collectionNFTMintKeypair.publicKey.toBuffer(),
        Buffer.from("collection_authority"),
        collectionAuthorityKeypair.publicKey.toBuffer()
    ], TOKEN_METADATA_PROGRAM_ID);

    const currentCollectionAuthority = await connection.getAccountInfo(currentCollectionAuthorityRecordAddress[0]);
    console.log({ currentCollectionAuthority })


    // demo of verifying a collection without a collection authority account
    const tx2 = new Transaction();
    const firstNFTMintKeypair = Keypair.generate();

    const createFirstNFTMintAccountInstruction = SystemProgram.createAccount({
        fromPubkey: adminKeypair.publicKey,
        newAccountPubkey: firstNFTMintKeypair.publicKey,
        lamports: await connection.getMinimumBalanceForRentExemption(MintLayout.span),
        space: MintLayout.span,
        programId: TOKEN_PROGRAM_ID
    });

    const intializeFirstNFTMintInstruction = Token.createInitMintInstruction(
        TOKEN_PROGRAM_ID,
        firstNFTMintKeypair.publicKey,
        0,
        adminKeypair.publicKey,
        adminKeypair.publicKey
    );

    const firstNFTMetadataAddress = PublicKey.findProgramAddressSync([
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        firstNFTMintKeypair.publicKey.toBuffer(),
    ], TOKEN_METADATA_PROGRAM_ID);

    const createFirstNFTMetadataInstruction = createCreateMetadataAccountV2Instruction({
        metadata: firstNFTMetadataAddress[0],
        mint: firstNFTMintKeypair.publicKey,
        mintAuthority: adminKeypair.publicKey,
        payer: adminKeypair.publicKey,
        updateAuthority: adminKeypair.publicKey,
    }, {
        createMetadataAccountArgsV2: {
            data: {
                name: "Test From Devland",
                symbol: "DEVLAND",
                uri: "https://api.jsonbin.io/b/627e726138be29676103f1ae/1",
                sellerFeeBasisPoints: 0,
                creators: [{
                    address: adminKeypair.publicKey,
                    share: 100,
                    verified: false,
                }],
                collection: {
                    key: collectionNFTMintKeypair.publicKey,
                    verified: false
                },
                uses: {
                    useMethod: UseMethod.Burn,
                    remaining: 0,
                    total: 0,
                },
            },
            isMutable: true,
        },
    });

    const recipientFirstNFTAssociatedTokenAccountAddress = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        firstNFTMintKeypair.publicKey,
        recipientKeypair.publicKey,
        false
    );

    const createRecipientFirstNFTAssociatedTokenAccountInstruction = Token.createAssociatedTokenAccountInstruction(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        firstNFTMintKeypair.publicKey,
        recipientFirstNFTAssociatedTokenAccountAddress,
        recipientKeypair.publicKey,
        adminKeypair.publicKey
    );

    const mintFirstNFTInstruction = Token.createMintToInstruction(
        TOKEN_PROGRAM_ID,
        firstNFTMintKeypair.publicKey,
        recipientFirstNFTAssociatedTokenAccountAddress,
        adminKeypair.publicKey,
        [],
        1
    );

    const disableFirstNFTMintInstruction = Token.createSetAuthorityInstruction(
        TOKEN_PROGRAM_ID,
        firstNFTMintKeypair.publicKey,
        null,
        "MintTokens",
        adminKeypair.publicKey,
        []
    );

    const signFirstNFTMetadataInstruction = createSignMetadataInstruction({
        metadata: firstNFTMetadataAddress[0],
        creator: adminKeypair.publicKey
    });

    const verifyFirstNFTCollectionInstruction = createVerifyCollectionInstruction({
        metadata: firstNFTMetadataAddress[0],
        collectionAuthority: adminKeypair.publicKey,
        payer: adminKeypair.publicKey,
        collectionMint: collectionNFTMintKeypair.publicKey,
        collection: collectionNFTMetadataAddress[0],
        collectionMasterEditionAccount: collectionNFTMasterEditionAddress[0]
    })

    tx2.add(createFirstNFTMintAccountInstruction)
        .add(intializeFirstNFTMintInstruction)
        .add(createFirstNFTMetadataInstruction)
        .add(createRecipientFirstNFTAssociatedTokenAccountInstruction)
        .add(mintFirstNFTInstruction)
        .add(disableFirstNFTMintInstruction)
        .add(signFirstNFTMetadataInstruction)
        .add(verifyFirstNFTCollectionInstruction);

    try {
        // we have to sign the transaction with our newly created collectionNFTMintKeypair to prove we own
        // it.
        const tx2Signature = await connection.sendTransaction(tx2, [adminKeypair, firstNFTMintKeypair]);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        const confirmation = await connection.confirmTransaction({ signature: tx2Signature, blockhash, lastValidBlockHeight });

        // fail immediately if there is some error from Solana.
        // errors are usually caught in the transaction simulation.
        // transaction simulations are turned on by default but they can be disabled in the "send transaction config".
        if (confirmation.value.err) {
            console.error(confirmation.value.err.toString());
            process.exit(1);
        }

        console.log("sent and confirmed transaction: ", tx2Signature);

    } catch (e) {
        // this is here to show us the logs from the transaction simulation.
        // NOTE: they will be swallowed by the promise machinery if we don't manually log them here.
        console.error(e);
        process.exit(1);
    }

}

run().then(() => {
    console.log("completed")
})